import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { mcpHealth, mcpStatus } from "../client/mcp-client";
import { engineHealth } from "../client/engine-client";
import {
  LAUNCH_AGENT_LABEL,
  SYSTEMD_SERVICE_NAME,
  launchAgentPlistPath,
  systemdUnitPath,
} from "../daemon-manager";
import { selfHealEngine } from "./heal-engine";
import type { HealReport, HealStep } from "./heal-engine";
import { pidListeningOn } from "../util/ports";
export { pidListeningOn };
import { GREEN, RED, YELLOW, DIM, BOLD, RESET, brand } from "../ui/styles";

type Severity = "ok" | "warn" | "crit";

interface CheckResult {
  severity: Severity;
  label: string;
  lines: string[];
  hint?: string;
}

function beheldDir(): string {
  return process.env.BEHELD_DATA_DIR
    ? join(process.env.BEHELD_DATA_DIR, ".beheld")
    : join(homedir(), ".beheld");
}

function pidFilePath(): string {
  return join(beheldDir(), "daemon.pid");
}

function sessionsDir(): string {
  return join(beheldDir(), "sessions");
}

function engineBinaryPath(): string {
  return join(beheldDir(), "bin", "engine");
}

function readPidFile(): { mcp?: number; engine?: number } | null {
  const fp = pidFilePath();
  if (!existsSync(fp)) return null;
  try {
    return JSON.parse(readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftDate(s: string, days: number): string {
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return localDateString(date);
}

// ── individual checks ────────────────────────────────────────────────────────

async function checkMcp(): Promise<CheckResult> {
  const port = mcpPort();
  const health = await mcpHealth();
  if (!health?.ok) {
    return {
      severity: "crit",
      label: `MCP server (port ${port})`,
      lines: [`${RED}✗${RESET} not responding on /health`],
      hint: "try: beheld start",
    };
  }
  const status = await mcpStatus();
  const version = (health as { version?: string }).version ?? "?";
  const pid = status?.pid;
  return {
    severity: "ok",
    label: `MCP server (port ${port})`,
    lines: [
      `${GREEN}✓${RESET} responding on /health (v${version})`,
      pid ? `${GREEN}✓${RESET} PID ${pid}` : `${DIM}PID unavailable${RESET}`,
    ],
  };
}

export interface ProcInfo {
  stat: string;
  cpuPct: number;
  etime: string;
}

// Pure: testable without spawning a process.
// Expects the line "STAT %CPU ETIME" (variable whitespace separators).
function parseProcOutput(line: string): ProcInfo | undefined {
  const parts = line.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3) return undefined;
  const stat = parts[0]!;
  const cpuPct = parseFloat(parts[1]!);
  const etime = parts[2]!;
  if (!Number.isFinite(cpuPct)) return undefined;
  return { stat, cpuPct, etime };
}

function inspectProcess(pid: number): ProcInfo | undefined {
  // `ps -o stat=,%cpu=,etime=` works on both macOS and Linux; the trailing `=`
  // on each field suppresses the header.
  const res = spawnSync("ps", ["-o", "stat=,%cpu=,etime=", "-p", String(pid)], {
    stdio: "pipe",
  });
  if (res.status !== 0) return undefined;
  return parseProcOutput(res.stdout?.toString() ?? "");
}

export interface EngineProbes {
  fetchEnginePid?: () => Promise<number | undefined>;
  engineHealth?: () => Promise<{ ok: boolean; version?: string } | null>;
  inspectProcess?: (pid: number) => ProcInfo | undefined;
}

export type EngineCheck = CheckResult & {
  runtimePid?: number;
  proc?: ProcInfo;
};

async function checkEngine(probes: EngineProbes = {}): Promise<EngineCheck> {
  const port = enginePort();
  const getPid = probes.fetchEnginePid ?? fetchEnginePid;
  const getHealth = probes.engineHealth ?? engineHealth;
  const inspect = probes.inspectProcess ?? inspectProcess;

  // Always resolve the PID by port — not only in the success path.
  const runtimePid = await getPid();
  const health = await getHealth();
  if (!health?.ok) {
    if (runtimePid !== undefined) {
      // Port LISTEN + /health not responding → alive but HTTP stuck.
      const proc = inspect(runtimePid);
      const looksBusyLoop =
        proc !== undefined && proc.stat.includes("R") && proc.cpuPct > 50;
      return {
        severity: "crit",
        label: `Scoring engine (port ${port})`,
        lines: [
          `${RED}✗${RESET} port ${port} LISTEN on PID ${runtimePid} but /health not responding`,
          looksBusyLoop
            ? `${RED}✗${RESET} likely busy-loop (STAT=${proc!.stat}, CPU=${proc!.cpuPct}%, etime=${proc!.etime})`
            : `${YELLOW}⚠${RESET} process alive, HTTP stuck${
                proc ? ` (STAT=${proc.stat}, CPU=${proc.cpuPct}%)` : ""
              }`,
        ],
        hint: looksBusyLoop
          ? `suggested fix: kill -9 ${runtimePid} && beheld start`
          : "try: beheld restart",
        runtimePid,
        proc,
      };
    }
    // No listener: engine really offline.
    return {
      severity: "crit",
      label: `Scoring engine (port ${port})`,
      lines: [`${RED}✗${RESET} port ${port} has no listener — engine offline`],
      hint: "try: beheld start",
    };
  }
  const version = (health as { version?: string }).version ?? "?";
  return {
    severity: "ok",
    label: `Scoring engine (port ${port})`,
    lines: [
      `${GREEN}✓${RESET} responding on /health (v${version})`,
      runtimePid ? `${GREEN}✓${RESET} PID ${runtimePid}` : `${DIM}PID unavailable${RESET}`,
    ],
    runtimePid,
  };
}

function portFromUrl(url: string | undefined, fallback: number): number {
  if (!url) return fallback;
  try {
    const parsed = new URL(url);
    const n = parseInt(parsed.port, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

function mcpPort(): number {
  return portFromUrl(process.env.BEHELD_MCP_URL, 7337);
}

function enginePort(): number {
  return portFromUrl(process.env.BEHELD_ENGINE_URL, 7338);
}

// pidListeningOn now lives in util/ports.ts (shared with supervisor).
// Re-exported below to preserve the D0-D2 test contracts.

async function fetchEnginePid(): Promise<number | undefined> {
  return pidListeningOn(enginePort());
}

function checkPidFile(runtimeEnginePid: number | undefined): CheckResult {
  const pids = readPidFile();
  if (!pids) {
    return {
      severity: "warn",
      label: "PID file",
      lines: [`${YELLOW}⚠${RESET} ~/.beheld/daemon.pid does not exist`],
      hint: "try: beheld start",
    };
  }
  const lines = [`${GREEN}✓${RESET} ${pidFilePath().replace(homedir(), "~")} exists`];
  let severity: Severity = "ok";
  let hint: string | undefined;
  if (runtimeEnginePid !== undefined && pids.engine !== undefined && pids.engine !== runtimeEnginePid) {
    lines.push(
      `${YELLOW}⚠${RESET} recorded PID (${pids.engine}) differs from actual engine PID (${runtimeEnginePid})`,
    );
    severity = "warn";
    hint = "suggested fix: beheld restart";
  }
  return { severity, label: "PID file", lines, hint };
}

function checkCodesignMacOS(): CheckResult | null {
  if (platform() !== "darwin") return null;
  const bin = engineBinaryPath();
  if (!existsSync(bin)) {
    return {
      severity: "warn",
      label: "Codesign (macOS)",
      lines: [`${YELLOW}⚠${RESET} engine binary not yet extracted at ${bin.replace(homedir(), "~")}`],
      hint: "run: beheld start (extracts the binary the first time)",
    };
  }
  const lines: string[] = [];
  let severity: Severity = "ok";
  let hint: string | undefined;

  const codesignRes = spawnSync("codesign", ["-dv", bin], { stdio: "pipe" });
  const codesignOut = (codesignRes.stderr?.toString() ?? "") + (codesignRes.stdout?.toString() ?? "");
  if (codesignRes.status === 0) {
    const adhoc = codesignOut.includes("Signature=adhoc") || codesignOut.includes("flags=0x2");
    lines.push(
      adhoc
        ? `${GREEN}✓${RESET} engine signed (adhoc)`
        : `${GREEN}✓${RESET} engine signed`,
    );
  } else {
    lines.push(`${YELLOW}⚠${RESET} engine not signed (codesign failed)`);
    severity = "warn";
    hint = "try: beheld start (re-extracts and re-signs)";
  }

  const xattrRes = spawnSync("xattr", [bin], { stdio: "pipe" });
  const xattrOut = (xattrRes.stdout?.toString() ?? "");
  if (xattrOut.includes("com.apple.quarantine")) {
    lines.push(`${YELLOW}⚠${RESET} quarantine attribute present`);
    severity = "warn";
    hint = `command: xattr -d com.apple.quarantine ${bin.replace(homedir(), "~")}`;
  } else {
    lines.push(`${GREEN}✓${RESET} no quarantine attribute`);
  }

  return { severity, label: "Codesign (macOS)", lines, hint };
}

function claudeCodeOptedIn(): boolean {
  try {
    const cfg = JSON.parse(
      readFileSync(join(beheldDir(), "config.json"), "utf8"),
    ) as { environments?: { claudeCode?: unknown } };
    return cfg.environments?.claudeCode === true;
  } catch {
    return false;
  }
}

async function checkClaudeIntegration(): Promise<CheckResult> {
  const { claudeCommandPath, claudeJsonPath, selfHealClaudeIntegration } =
    await import("../config/hooks");

  if (!claudeCodeOptedIn()) {
    return {
      severity: "ok",
      label: "Claude Code integration (/beheld)",
      lines: [`${DIM}Claude Code not enabled — optional step${RESET}`],
    };
  }

  // Self-heal first: doctor both diagnoses AND repairs a vanished /beheld.
  let healed = { slashCommandRestored: false, mcpServerRestored: false };
  try {
    healed = await selfHealClaudeIntegration();
  } catch {
    /* fall through to report raw state */
  }

  const commandFile = claudeCommandPath();
  const hasCommand =
    existsSync(commandFile) && readFileSync(commandFile, "utf8").trim().length > 0;

  let hasMcp = false;
  try {
    const cfg = JSON.parse(readFileSync(claudeJsonPath(), "utf8")) as {
      mcpServers?: Record<string, { args?: unknown }>;
    };
    const entry = cfg.mcpServers?.["beheld"];
    hasMcp = !!entry && Array.isArray(entry.args) && entry.args.includes("--stdio");
  } catch {
    /* hasMcp stays false */
  }

  const lines = [
    hasCommand
      ? `${GREEN}✓${RESET} slash command ${commandFile.replace(homedir(), "~")}${healed.slashCommandRestored ? " (restored just now)" : ""}`
      : `${RED}✗${RESET} slash command missing — /beheld does not show up`,
    hasMcp
      ? `${GREEN}✓${RESET} MCP server registered in ~/.claude.json${healed.mcpServerRestored ? " (restored just now)" : ""}`
      : `${RED}✗${RESET} MCP server not registered in ~/.claude.json`,
  ];

  const severity: Severity = hasCommand && hasMcp ? "ok" : "crit";
  return {
    severity,
    label: "Claude Code integration (/beheld)",
    lines,
    hint: severity === "ok" ? undefined : "run: beheld init (check Claude Code)",
  };
}

// ── processing probes (disk — independent of a live engine) ────────────────

interface SessionEntry {
  name: string;
  size: number;
  mtime: number;
}

export interface ProcessingSnapshot {
  cursor: { offsets: Record<string, number>; mtime: number } | null;
  sessions: SessionEntry[];
  profileDb: { mtime: number } | null;
  profileDbWal: { size: number } | null;
}

export const CURSOR_STALENESS_THRESHOLD_MS = 5 * 60 * 1000;
const DB_WRITE_STALENESS_THRESHOLD_MS = 5 * 60 * 1000;
const WAL_WARN_THRESHOLD_BYTES = 4 * 1024 * 1024;

function cursorPath(): string {
  return join(beheldDir(), ".cursor");
}

function profileDbPath(): string {
  return join(beheldDir(), "profile.db");
}

function profileDbWalPath(): string {
  return join(beheldDir(), "profile.db-wal");
}

async function takeProcessingSnapshot(): Promise<ProcessingSnapshot> {
  // Cursor — JSON with { offsets: { <session-filename>: <byte offset>, ... } }
  // (format confirmed in the engine: packages/engine/src/reader/jsonl_reader.py)
  let cursor: ProcessingSnapshot["cursor"] = null;
  const cp = cursorPath();
  if (existsSync(cp)) {
    try {
      const raw = JSON.parse(readFileSync(cp, "utf8")) as { offsets?: unknown };
      const offsets: Record<string, number> = {};
      if (raw && typeof raw === "object" && raw.offsets && typeof raw.offsets === "object") {
        for (const [k, v] of Object.entries(raw.offsets as Record<string, unknown>)) {
          if (typeof v === "number" && Number.isFinite(v)) offsets[k] = v;
        }
      }
      const mtime = statSync(cp).mtimeMs;
      cursor = { offsets, mtime };
    } catch {
      cursor = null;
    }
  }

  // Sessions — fs.stat on each *.jsonl; lexical order = chronological.
  const sessions: SessionEntry[] = [];
  const dir = sessionsDir();
  if (existsSync(dir)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      entries = [];
    }
    for (const name of entries) {
      if (!name.endsWith(".jsonl")) continue;
      try {
        const st = statSync(join(dir, name));
        sessions.push({ name, size: st.size, mtime: st.mtimeMs });
      } catch {
        /* skip unreadable */
      }
    }
    sessions.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  // profile.db + WAL
  let profileDb: ProcessingSnapshot["profileDb"] = null;
  const dbp = profileDbPath();
  if (existsSync(dbp)) {
    try {
      profileDb = { mtime: statSync(dbp).mtimeMs };
    } catch {
      profileDb = null;
    }
  }

  let profileDbWal: ProcessingSnapshot["profileDbWal"] = null;
  const walp = profileDbWalPath();
  if (existsSync(walp)) {
    try {
      profileDbWal = { size: statSync(walp).size };
    } catch {
      profileDbWal = null;
    }
  }

  return { cursor, sessions, profileDb, profileDbWal };
}

// ── pure formatters ─────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  const clamped = Math.max(0, ms);
  const s = Math.floor(clamped / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ── pure evaluators ─────────────────────────────────────────────────────────

function evaluateCursorStaleness(
  snap: ProcessingSnapshot,
  _now: number,
  thresholdMs: number,
): CheckResult {
  const label = "reader cursor";
  if (snap.sessions.length === 0) {
    return { severity: "ok", label, lines: [`${DIM}nothing to process yet${RESET}`] };
  }
  if (snap.cursor === null) {
    return {
      severity: "warn",
      label,
      lines: [`${YELLOW}⚠${RESET} no ~/.beheld/.cursor — engine has never processed`],
      hint: "try: beheld start",
    };
  }
  const newest = Math.max(...snap.sessions.map((s) => s.mtime));
  const delta = Math.max(0, newest - snap.cursor.mtime);
  if (delta <= thresholdMs) {
    return { severity: "ok", label, lines: [`${GREEN}✓${RESET} cursor advanced recently`] };
  }
  return {
    severity: "warn",
    label,
    lines: [`${YELLOW}⚠${RESET} cursor stuck for ${formatDuration(delta)} vs newest session`],
    hint: "engine may be stuck — check /health",
  };
}

function evaluateDbWrite(
  snap: ProcessingSnapshot,
  _now: number,
  thresholdMs: number,
): CheckResult {
  const label = "profile.db writes";
  if (snap.profileDb === null) {
    return {
      severity: "warn",
      label,
      lines: [`${YELLOW}⚠${RESET} ~/.beheld/profile.db does not exist`],
      hint: "try: beheld start",
    };
  }
  if (snap.sessions.length === 0) {
    return { severity: "ok", label, lines: [`${DIM}no sessions to process${RESET}`] };
  }
  const newest = Math.max(...snap.sessions.map((s) => s.mtime));
  const delta = Math.max(0, newest - snap.profileDb.mtime);
  if (delta <= thresholdMs) {
    return { severity: "ok", label, lines: [`${GREEN}✓${RESET} recent write to profile.db`] };
  }
  return {
    severity: "warn",
    label,
    lines: [`${YELLOW}⚠${RESET} no writes for ${formatDuration(delta)} vs newest session`],
    hint: "engine may have stopped persisting scores",
  };
}

function evaluateWal(snap: ProcessingSnapshot, thresholdBytes: number): CheckResult {
  const label = "SQLite WAL";
  if (snap.profileDbWal === null || snap.profileDbWal.size === 0) {
    return { severity: "ok", label, lines: [`${DIM}WAL missing or empty${RESET}`] };
  }
  const size = snap.profileDbWal.size;
  if (size <= thresholdBytes) {
    return { severity: "ok", label, lines: [`${GREEN}✓${RESET} WAL at ${formatBytes(size)}`] };
  }
  return {
    severity: "warn",
    label,
    lines: [
      `${YELLOW}⚠${RESET} WAL bloated (${formatBytes(size)}) — checkpoint is not running`,
    ],
    hint: 'sqlite3 ~/.beheld/profile.db "PRAGMA wal_checkpoint(TRUNCATE);"',
  };
}

function evaluateBacklog(snap: ProcessingSnapshot): CheckResult {
  const label = "event backlog";
  if (snap.sessions.length === 0) {
    return {
      severity: "ok",
      label,
      lines: [`${GREEN}✓${RESET} no sessions recorded`],
    };
  }
  const offsets = snap.cursor?.offsets ?? {};
  let unread = 0;
  for (const s of snap.sessions) {
    const off = offsets[s.name] ?? 0;
    unread += Math.max(0, s.size - off);
  }
  if (unread === 0) {
    return {
      severity: "ok",
      label,
      lines: [`${GREEN}✓${RESET} cursor covered all sessions`],
    };
  }
  return {
    severity: "warn",
    label,
    lines: [`${YELLOW}⚠${RESET} ${formatBytes(unread)} (${unread} bytes) pending in JSONL after the cursor`],
    hint: "check reader.cursor / db.write — engine may have stopped processing",
  };
}

// ── autostart probe (LaunchAgent on macOS / systemd user on Linux) ──────────

function parseLaunchctlList(stdout: string): { pid?: number } {
  // launchctl list <label> emits a plist-like blob:
  //   { "PID" = 12345; "LastExitStatus" = 0; ... }
  // When loaded without a PID → "PID" is absent.
  const m = stdout.match(/"PID"\s*=\s*(\d+)\s*;/);
  if (!m) return {};
  const n = parseInt(m[1]!, 10);
  return Number.isFinite(n) ? { pid: n } : {};
}

function evaluateSystemdState(
  isEnabledStdout: string,
  isActiveStdout: string,
): { enabled: boolean; active: boolean } {
  const e = isEnabledStdout.trim();
  const a = isActiveStdout.trim();
  // "static" = always available (cannot be disabled) — equivalent to enabled.
  const enabled = e === "enabled" || e === "static";
  const active = a === "active";
  return { enabled, active };
}

function checkAutostartMacOS(): CheckResult {
  const label = `Autostart (LaunchAgent ${LAUNCH_AGENT_LABEL})`;
  const plist = launchAgentPlistPath();
  if (!existsSync(plist)) {
    return {
      severity: "warn",
      label,
      lines: [
        `${YELLOW}⚠${RESET} LaunchAgent ${LAUNCH_AGENT_LABEL} missing at ${plist.replace(homedir(), "~")}`,
      ],
      hint: "run: beheld init",
    };
  }
  const res = spawnSync("launchctl", ["list", LAUNCH_AGENT_LABEL], { stdio: "pipe" });
  if (res.status !== 0) {
    return {
      severity: "warn",
      label,
      lines: [`${YELLOW}⚠${RESET} LaunchAgent ${LAUNCH_AGENT_LABEL} installed but not loaded`],
      hint: `launchctl bootstrap gui/$UID ${plist.replace(homedir(), "~")}`,
    };
  }
  const parsed = parseLaunchctlList(res.stdout?.toString() ?? "");
  if (parsed.pid === undefined) {
    return {
      severity: "warn",
      label,
      lines: [`${YELLOW}⚠${RESET} LaunchAgent ${LAUNCH_AGENT_LABEL} loaded but inactive`],
      hint: `launchctl kickstart gui/$UID/${LAUNCH_AGENT_LABEL}`,
    };
  }
  return {
    severity: "ok",
    label,
    lines: [`${GREEN}✓${RESET} LaunchAgent ${LAUNCH_AGENT_LABEL} active (PID ${parsed.pid})`],
  };
}

function checkAutostartLinux(): CheckResult {
  const label = `Autostart (systemd ${SYSTEMD_SERVICE_NAME})`;
  const unit = systemdUnitPath();
  if (!existsSync(unit)) {
    return {
      severity: "warn",
      label,
      lines: [`${YELLOW}⚠${RESET} ${SYSTEMD_SERVICE_NAME} service not installed`],
      hint: "run: beheld init",
    };
  }
  const enabledRes = spawnSync("systemctl", ["--user", "is-enabled", SYSTEMD_SERVICE_NAME], {
    stdio: "pipe",
  });
  const activeRes = spawnSync("systemctl", ["--user", "is-active", SYSTEMD_SERVICE_NAME], {
    stdio: "pipe",
  });
  const enabledOut = enabledRes.stdout?.toString() ?? "";
  const activeOut = activeRes.stdout?.toString() ?? "";
  const state = evaluateSystemdState(enabledOut, activeOut);

  if (state.enabled && state.active) {
    return {
      severity: "ok",
      label,
      lines: [`${GREEN}✓${RESET} ${SYSTEMD_SERVICE_NAME} service enabled and active`],
    };
  }
  if (state.enabled && !state.active) {
    return {
      severity: "warn",
      label,
      lines: [
        `${YELLOW}⚠${RESET} ${SYSTEMD_SERVICE_NAME} service enabled but ${activeOut.trim() || "?"}`,
      ],
      hint: `systemctl --user start ${SYSTEMD_SERVICE_NAME}`,
    };
  }
  if (!state.enabled && state.active) {
    return {
      severity: "warn",
      label,
      lines: [
        `${YELLOW}⚠${RESET} ${SYSTEMD_SERVICE_NAME} service active now but won't restart after reboot`,
      ],
      hint: `systemctl --user enable ${SYSTEMD_SERVICE_NAME}`,
    };
  }
  return {
    severity: "warn",
    label,
    lines: [`${YELLOW}⚠${RESET} ${SYSTEMD_SERVICE_NAME} service not enabled`],
    hint: `systemctl --user enable --now ${SYSTEMD_SERVICE_NAME}`,
  };
}

function checkAutostart(): CheckResult | null {
  if (platform() === "darwin") return checkAutostartMacOS();
  if (platform() === "linux") return checkAutostartLinux();
  return null;
}

// ── log.signatures probe ────────────────────────────────────────────────────

interface LogSignature {
  pattern: string;
  hint: string;
}

const LOG_SIGNATURES: LogSignature[] = [
  {
    pattern: "Errno 48",
    hint: "socket stuck — likely zombie engine; run doctor periodically",
  },
  {
    pattern: "Address already in use",
    hint: "same root cause as Errno 48 (varies by libc/distro)",
  },
  {
    pattern: "engine trigger timeout",
    hint: "engine not responding to daemon triggers",
  },
  {
    pattern: "Engine failed to start",
    hint: "auto-restart hit the wall — check busy-loop / stale PID",
  },
  {
    pattern: "MCP server failed to start",
    hint: "MCP auto-restart hit the wall — check if port 7337 is taken",
  },
  {
    pattern: "Traceback (most recent call last)",
    hint: "unhandled exception — check ~/.beheld/daemon.log",
  },
];

const LOG_TAIL_BYTES = 64 * 1024;

function daemonLogPath(): string {
  return join(beheldDir(), "daemon.log");
}

function readLogTail(path: string, maxBytes: number): string | null {
  let st;
  try {
    st = statSync(path);
  } catch {
    return null;
  }
  if (st.size <= maxBytes) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  }
  // File larger than maxBytes → read only the suffix.
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(maxBytes);
    readSync(fd, buf, 0, maxBytes, st.size - maxBytes);
    return buf.toString("utf8");
  } catch {
    return null;
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
  }
}

function findSignaturesInLog(
  text: string,
  signatures: LogSignature[],
): Array<{ pattern: string; count: number; hint: string }> {
  const hits: Array<{ pattern: string; count: number; hint: string }> = [];
  for (const sig of signatures) {
    if (!sig.pattern) continue;
    let count = 0;
    let idx = 0;
    while (true) {
      const found = text.indexOf(sig.pattern, idx);
      if (found < 0) break;
      count++;
      idx = found + sig.pattern.length;
    }
    if (count > 0) hits.push({ pattern: sig.pattern, count, hint: sig.hint });
  }
  return hits;
}

function checkLogSignatures(): CheckResult {
  const label = "daemon.log signatures";
  const path = daemonLogPath();
  if (!existsSync(path)) {
    return {
      severity: "ok",
      label,
      lines: [`${DIM}~/.beheld/daemon.log not created yet${RESET}`],
    };
  }
  const tail = readLogTail(path, LOG_TAIL_BYTES);
  if (tail === null) {
    return {
      severity: "warn",
      label,
      lines: [`${YELLOW}⚠${RESET} could not read ~/.beheld/daemon.log`],
    };
  }
  const hits = findSignaturesInLog(tail, LOG_SIGNATURES);
  if (hits.length === 0) {
    return {
      severity: "ok",
      label,
      lines: [`${GREEN}✓${RESET} no known signatures in the last 64 KB of the log`],
    };
  }
  const summary = hits.map((h) => `"${h.pattern}" (×${h.count})`).join(", ");
  return {
    severity: "warn",
    label,
    lines: [`${YELLOW}⚠${RESET} daemon.log signatures: ${summary}`],
    hint: hits[0]!.hint,
  };
}

function computeExitCode(all: CheckResult[]): 0 | 1 | 2 {
  if (all.some((r) => r.severity === "crit")) return 2;
  if (all.some((r) => r.severity === "warn")) return 1;
  return 0;
}

/**
 * Pure decision: the 4 coincident conditions of a confirmed busy-loop.
 * Returns true iff:
 *   1. there is a listener on the engine port (runtimePid !== undefined);
 *   2. /health failed (severity === "crit");
 *   3. ps confirms STAT contains R and CPU > 50%;
 *   4. cursor exists, there are sessions, and the lag (newest - cursor.mtime)
 *      is STRICTLY greater than the D1.a staleness threshold.
 *
 * Otherwise → false. Doctor keeps just reporting, no action.
 */
function isInequivocalBusyLoop(
  engine: EngineCheck,
  snap: ProcessingSnapshot,
  cursorStalenessThresholdMs: number,
): boolean {
  if (engine.runtimePid === undefined) return false;
  if (engine.severity !== "crit") return false;
  const proc = engine.proc;
  if (proc === undefined) return false;
  if (!proc.stat.includes("R")) return false;
  if (proc.cpuPct <= 50) return false;
  if (snap.cursor === null) return false;
  if (snap.sessions.length === 0) return false;
  const newest = Math.max(...snap.sessions.map((s) => s.mtime));
  const lagMs = newest - snap.cursor.mtime;
  return lagMs > cursorStalenessThresholdMs;
}

interface JsonlSample {
  filesScanned: number;
  events: number;
  sessions: Set<string>;
  corruptedLines: number;
}

function scanTodayJsonl(): JsonlSample | null {
  const dir = sessionsDir();
  if (!existsSync(dir)) return null;
  const today = localDateString();
  const prefixes = new Set([shiftDate(today, -1), today, shiftDate(today, +1)]);
  const sample: JsonlSample = {
    filesScanned: 0,
    events: 0,
    sessions: new Set(),
    corruptedLines: 0,
  };
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return null;
  }
  for (const f of files) {
    if (!f.endsWith(".jsonl")) continue;
    if (!prefixes.has(f.slice(0, 10))) continue;
    sample.filesScanned++;
    let content: string;
    try {
      content = readFileSync(join(dir, f), "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const e = JSON.parse(trimmed) as { timestamp?: unknown; session_id?: unknown };
        if (typeof e.timestamp !== "string" || typeof e.session_id !== "string") continue;
        const d = new Date(e.timestamp);
        const local = localDateString(d);
        if (local !== today) continue;
        sample.events++;
        sample.sessions.add(e.session_id);
      } catch {
        sample.corruptedLines++;
      }
    }
  }
  return sample;
}

async function checkJsonlToday(): Promise<CheckResult> {
  const sample = scanTodayJsonl();
  if (sample === null) {
    return {
      severity: "warn",
      label: "today's JSONL",
      lines: [`${YELLOW}⚠${RESET} ~/.beheld/sessions/ does not exist`],
      hint: "run: beheld init",
    };
  }
  const today = localDateString();
  const lines: string[] = [
    `${GREEN}✓${RESET} ${sample.events} events today in ${sessionsDir().replace(homedir(), "~")}/${today}_*.jsonl`,
  ];
  let severity: Severity = "ok";
  let hint: string | undefined;
  if (sample.corruptedLines > 0) {
    lines.push(`${YELLOW}⚠${RESET} ${sample.corruptedLines} corrupted line(s) ignored`);
    severity = "warn";
  }

  const status = await mcpStatus();
  if (status) {
    const mcpEvents = status.events_today ?? 0;
    if (mcpEvents === sample.events) {
      lines.push(`${GREEN}✓${RESET} in-memory counter matches disk (${mcpEvents})`);
    } else if (Math.abs(mcpEvents - sample.events) <= 5) {
      // Small diff acceptable: events can land between scan and /status call
      lines.push(`${GREEN}✓${RESET} in-memory counter ≈ disk (${mcpEvents} vs ${sample.events})`);
    } else {
      lines.push(`${YELLOW}⚠${RESET} in-memory counter (${mcpEvents}) differs from disk (${sample.events})`);
      severity = "warn";
      hint = "suggested fix: beheld restart";
    }
  }

  return { severity, label: "today's JSONL", lines, hint };
}

// ── orchestration ─────────────────────────────────────────────────────────────

function emoji(severity: Severity): string {
  if (severity === "ok") return `${GREEN}✓${RESET}`;
  if (severity === "warn") return `${YELLOW}⚠${RESET}`;
  return `${RED}✗${RESET}`;
}

function printResult(r: CheckResult): void {
  console.log(`${BOLD}🔍 Checking ${r.label}…${RESET}`);
  for (const line of r.lines) {
    console.log(`   ${line}`);
  }
  if (r.hint) {
    console.log(`      ${DIM}${r.hint}${RESET}`);
  }
  console.log("");
}

// ── heal report rendering ────────────────────────────────────────────────────

function humanStepLabel(step: HealStep): string {
  switch (step.name) {
    case "prepare-diagnostics-dir":
      return step.ok ? "diagnostics dir prepared" : `diagnostics dir: ${step.detail ?? "failed"}`;
    case "capture-stack":
      return step.ok
        ? `stack captured at ${(step.detail ?? "").replace(homedir(), "~")}`
        : `stack not captured (${step.detail ?? "unavailable"})`;
    case "kill-engine":
      return step.ok ? `engine killed (${step.detail ?? ""})` : `kill failed (${step.detail ?? ""})`;
    case "wait-socket-release":
      return step.ok ? `socket :7338 ${step.detail ?? "released"}` : `socket :7338 ${step.detail ?? "did not release"}`;
    case "wal-checkpoint":
      return step.ok ? "WAL checkpoint executed" : `WAL checkpoint failed: ${step.detail ?? "?"}`;
    case "clear-stale-engine-pid":
      return step.ok ? "daemon.pid cleaned (engine removed)" : "could not clean daemon.pid";
    case "restart-daemon":
      return step.ok ? "daemon restarted" : `daemon did not restart: ${step.detail ?? "?"}`;
    default:
      return step.name + (step.detail ? `: ${step.detail}` : "");
  }
}

function firstFailedStepHint(report: HealReport): string {
  const failed = report.steps.find((s) => !s.ok);
  if (!failed) return "inconsistent state — investigate ~/.beheld/daemon.log";
  switch (failed.name) {
    case "kill-engine":
      return `run manually: kill -9 ${report.evidence.runtimePid}`;
    case "wait-socket-release":
      return `socket :7338 still stuck — check lsof -iTCP:7338`;
    case "restart-daemon":
      return "run manually: beheld start";
    default:
      return `step ${failed.name} failed — check ~/.beheld/daemon.log`;
  }
}

function printHealReport(report: HealReport): void {
  console.log(`${BOLD}🔧 Auto-heal triggered: confirmed engine busy-loop${RESET}`);
  console.log("   Evidence:");
  console.log(`     • PID ${report.evidence.runtimePid} LISTEN on :${enginePort()}`);
  console.log(`     • /health timeout`);
  console.log(
    `     • STAT=${report.evidence.stat}, CPU=${report.evidence.cpuPct}%, etime=${report.evidence.etime}`,
  );
  console.log(`     • cursor stuck for ${formatDuration(report.evidence.cursorLagMs)} vs newest session`);
  console.log("   Steps:");
  for (const step of report.steps) {
    const mark = step.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`     ${mark} ${humanStepLabel(step)}`);
  }
  if (report.succeeded) {
    console.log(`   ${DIM}Run \`beheld doctor\` to confirm the post-heal state.${RESET}`);
  } else {
    console.log(`   ${RED}Heal failed${RESET} — escalate manually: ${DIM}${firstFailedStepHint(report)}${RESET}`);
  }
  console.log("");
}

export async function doctorCommand(): Promise<void> {
  console.log(brand("checking my health"));
  const mcp = await checkMcp();
  printResult(mcp);

  const engine = await checkEngine();
  printResult(engine);

  const pid = checkPidFile(engine.runtimePid);
  printResult(pid);

  const codesign = checkCodesignMacOS();
  if (codesign) printResult(codesign);

  const integration = await checkClaudeIntegration();
  printResult(integration);

  // Processing probes — read from disk, independent of a live engine.
  const snap = await takeProcessingSnapshot();
  const now = Date.now();
  const cursor = evaluateCursorStaleness(snap, now, CURSOR_STALENESS_THRESHOLD_MS);
  printResult(cursor);
  const dbWrite = evaluateDbWrite(snap, now, DB_WRITE_STALENESS_THRESHOLD_MS);
  printResult(dbWrite);
  const dbWal = evaluateWal(snap, WAL_WARN_THRESHOLD_BYTES);
  printResult(dbWal);
  const orphans = evaluateBacklog(snap);
  printResult(orphans);

  // Infra probes — autostart (platform-specific) and known log signatures.
  const autostart = checkAutostart();
  if (autostart) printResult(autostart);
  const logSigs = checkLogSignatures();
  printResult(logSigs);

  const jsonl = await checkJsonlToday();
  printResult(jsonl);

  // Telemetry status — one-line informational; never affects exit code.
  const { telemetryStatusForDoctor } = await import("./telemetry");
  console.log(`${BOLD}🔍 ${telemetryStatusForDoctor().replace("Status: ", "Telemetry:  ")}${RESET}`);
  console.log("");

  // ── summary ────────────────────────────────────────────────────────────────
  const all: CheckResult[] = [
    mcp,
    engine,
    pid,
    ...(codesign ? [codesign] : []),
    integration,
    cursor,
    dbWrite,
    dbWal,
    orphans,
    ...(autostart ? [autostart] : []),
    logSigs,
    jsonl,
  ];
  const crits = all.filter((c) => c.severity === "crit");
  const warns = all.filter((c) => c.severity === "warn");

  if (crits.length > 0) {
    console.log(`Result: ${RED}✗ Product degraded${RESET} — ${crits.length} critical issue(s), ${warns.length} warning(s)`);
    let n = 1;
    for (const c of crits) {
      console.log("");
      console.log(`${BOLD}${n}. ${c.label}${RESET}`);
      for (const line of c.lines) console.log(`   ${line}`);
      if (c.hint) console.log(`   ${DIM}${c.hint}${RESET}`);
      n++;
    }
    console.log("");

    // D2 — auto-heal only when the 4 busy-loop conditions coincide.
    // Exit code reflects the pre-heal snapshot (computeExitCode(all)) regardless
    // of heal success; user runs doctor again to verify.
    if (isInequivocalBusyLoop(engine, snap, CURSOR_STALENESS_THRESHOLD_MS)) {
      const report = await selfHealEngine(engine, snap);
      printHealReport(report);
    }

    process.exit(computeExitCode(all));
  }

  if (warns.length > 0) {
    console.log(`Result: ${YELLOW}⚠${RESET} ${warns.length} minor issue(s) found`);
    const firstHint = warns.find((w) => w.hint)?.hint;
    if (firstHint) console.log(`   ${DIM}${firstHint}${RESET}`);
    console.log("");
    process.exit(computeExitCode(all));
  }

  console.log(`Result: ${GREEN}✓ All green${RESET}`);
  console.log("");
}

// ── exports for testing ──────────────────────────────────────────────────────

export const _internal = {
  scanTodayJsonl,
  checkPidFile,
  checkCodesignMacOS,
  parseProcOutput,
  checkEngine,
  takeProcessingSnapshot,
  evaluateCursorStaleness,
  evaluateDbWrite,
  evaluateWal,
  evaluateBacklog,
  formatBytes,
  formatDuration,
  computeExitCode,
  parseLaunchctlList,
  evaluateSystemdState,
  checkAutostart,
  findSignaturesInLog,
  readLogTail,
  checkLogSignatures,
  LOG_SIGNATURES,
  isInequivocalBusyLoop,
  printHealReport,
  humanStepLabel,
  firstFailedStepHint,
};

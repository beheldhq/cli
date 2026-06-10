import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, openSync, chmodSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { ensureEngine } from "./engine-extractor";
import { mcpHealth } from "./client/mcp-client";
import { engineHealth } from "./client/engine-client";
import { pidListeningOn, engineHealthy, waitSocketRelease } from "./util/ports";
import {
  loadBackoffState,
  saveBackoffState,
  recordFailure,
  shouldSuspend,
  isSuspended,
  BACKOFF_THRESHOLD,
  BACKOFF_WINDOW_MS,
  type SupervisorBackoffState,
} from "./supervisor/backoff";

const beheldDir = () =>
  process.env.BEHELD_DATA_DIR
    ? join(process.env.BEHELD_DATA_DIR, ".beheld")
    : join(homedir(), ".beheld");

const pidFile = () => join(beheldDir(), "daemon.pid");
const logFile = () => join(beheldDir(), "daemon.log");
const binaryPath = () => join(homedir(), ".local", "bin", "beheld");

// Autostart identifiers — exported so other commands (e.g. doctor) can probe
// the LaunchAgent / systemd unit without duplicating the names.
export const LAUNCH_AGENT_LABEL = "com.beheld.daemon";
export const SYSTEMD_SERVICE_NAME = "beheld.service";
export const launchAgentPlistPath = (): string =>
  join(homedir(), "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
export const systemdUnitPath = (): string =>
  join(homedir(), ".config", "systemd", "user", SYSTEMD_SERVICE_NAME);

interface DaemonPids {
  mcp?: number;
  engine?: number;
}

function readPids(): DaemonPids {
  const f = pidFile();
  if (!existsSync(f)) return {};
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return {};
  }
}

function writePids(pids: DaemonPids): void {
  mkdirSync(beheldDir(), { recursive: true, mode: 0o700 });
  writeFileSync(pidFile(), JSON.stringify(pids));
}

/**
 * Ensures ~/.beheld and its subdirectories have secure permissions (0700).
 * Corrects existing installations that may have been created with looser modes.
 * Accepts an optional baseDir for testability; defaults to the live beheld dir.
 */
export function ensureSecurePermissions(baseDir?: string): void {
  const base = baseDir ?? beheldDir();
  const dirs = [base, join(base, "sessions"), join(base, "bin")];
  for (const dir of dirs) {
    if (existsSync(dir)) {
      try { chmodSync(dir, 0o700); } catch { /* ignore — no permission to chmod */ }
    }
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface StartResult {
  mcp: boolean;
  engine: boolean;
  alreadyRunning: boolean;
}

export async function isMcpRunning(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:7337/health", {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function isEngineRunning(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:7338/health", {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForHealthPort(
  port: number,
  timeoutMs = 10_000,
  intervalMs = 500,
): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

const ENGINE_PORT = 7338;
const MCP_PORT = 7337;
const HEALTH_PROBE_TIMEOUT_MS = 1500;
const SOCKET_RELEASE_TIMEOUT_MS = 2000;

function supervisorLog(msg: string): void {
  // `daemon.log` receives stdout/stderr from children via redirect. For
  // supervisor messages (not children), we write via console — when the
  // supervisor runs as a launchd child, that's captured by the plist's
  // StandardOutPath (the same daemon.log). When run interactively, it goes
  // to the user's terminal.
  console.log(`[supervisor] ${msg}`);
}

function logSuspendedNotice(state: SupervisorBackoffState): void {
  supervisorLog(
    `auto-restart suspended after ${state.engine_restart_failures.length} failures in ${BACKOFF_WINDOW_MS / 60000} min — engine entered a repeated busy-loop.`,
  );
  supervisorLog(`              Likely cause: pathological payload in ~/.beheld/sessions/ or systemic issue.`);
  supervisorLog(`              To investigate:`);
  supervisorLog(`                beheld doctor                    # current diagnosis`);
  supervisorLog(`                ls -la ~/.beheld/diagnostics/    # stacks captured by doctor`);
  supervisorLog(`              To resume auto-restart:`);
  supervisorLog(`                beheld start`);
}

/**
 * Engine pre-bind cleanup: handles socket :7338 already stuck.
 *
 * Three paths:
 *  - No listener         → return "ok-to-bind"  (normal path)
 *  - Healthy listener    → return "already-healthy" (idempotent, BAIL)
 *  - Zombie listener     → kill -9 by the LISTENER's PID (not the pid file's),
 *                          wait for socket release, return "cleaned" or throw.
 *
 * NEVER uses daemon.pid as the source of the PID to kill. The port is truth.
 */
async function preBindEngineCleanup(): Promise<"ok-to-bind" | "already-healthy" | "cleaned"> {
  const pid = pidListeningOn(ENGINE_PORT);
  if (pid === undefined) return "ok-to-bind";

  const healthy = await engineHealthy(ENGINE_PORT, HEALTH_PROBE_TIMEOUT_MS);
  if (healthy) {
    supervisorLog(`engine already healthy on :${ENGINE_PORT} (PID ${pid}); idempotent start`);
    return "already-healthy";
  }

  supervisorLog(`socket :${ENGINE_PORT} stuck on PID ${pid}; killing before restart`);
  try {
    process.kill(pid, "SIGKILL");
  } catch (e: unknown) {
    // ESRCH = already died between lsof and kill — ok, continue.
    if (typeof e !== "object" || !e || (e as { code?: string }).code !== "ESRCH") {
      throw new Error(`failed to kill PID ${pid}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const released = await waitSocketRelease(ENGINE_PORT, SOCKET_RELEASE_TIMEOUT_MS);
  if (!released) {
    throw new Error(`socket :${ENGINE_PORT} did not release after kill within ${SOCKET_RELEASE_TIMEOUT_MS}ms`);
  }
  return "cleaned";
}

export async function start(): Promise<StartResult> {
  // Layer 2: if the supervisor has already suspended itself, don't try anything.
  // The only way out is `beheld start` (which clears the state before calling).
  // On LaunchAgent re-run the state persists — that's the point: fork-bomb
  // prevention.
  const backoff = loadBackoffState();
  if (isSuspended(backoff)) {
    return { mcp: false, engine: false, alreadyRunning: false };
  }

  const [mcpAlreadyUp, engineAlreadyUp] = await Promise.all([
    isMcpRunning(),
    isEngineRunning(),
  ]);

  if (mcpAlreadyUp && engineAlreadyUp) {
    return { mcp: true, engine: true, alreadyRunning: true };
  }

  const engineDest = await ensureEngine();
  const log = logFile();
  mkdirSync(beheldDir(), { recursive: true, mode: 0o700 });

  const pids = readPids();

  if (!mcpAlreadyUp) {
    const bin = existsSync(binaryPath()) ? binaryPath() : process.execPath;
    const args = existsSync(binaryPath())
      ? ["server"]
      : [join(import.meta.dir, "index.ts"), "server"];
    const fd = openSync(log, "a");
    const child = spawn(bin, args, {
      detached: true,
      stdio: ["ignore", fd, fd],
      env: { ...process.env },
    });
    child.unref();
    pids.mcp = child.pid ?? undefined;
  }

  // Engine path: pre-bind cleanup + spawn. On any failure, record it for the
  // backoff before propagating.
  let engineSpawned = false;
  let engineBailedIdempotent = false;
  if (!engineAlreadyUp) {
    try {
      const cleanup = await preBindEngineCleanup();
      if (cleanup === "already-healthy") {
        // Healthy listener appeared between isEngineRunning() and here — don't respawn.
        engineBailedIdempotent = true;
      } else {
        const fd = openSync(log, "a");
        const child = spawn(engineDest, [], {
          detached: true,
          stdio: ["ignore", fd, fd],
          env: { ...process.env },
        });
        child.unref();
        pids.engine = child.pid ?? undefined;
        engineSpawned = true;
      }
    } catch (err) {
      // Record failure for the backoff and potentially suspend.
      const updated = recordFailure(backoff, Date.now());
      if (shouldSuspend(updated.engine_restart_failures, BACKOFF_THRESHOLD)) {
        updated.suspended_at = Date.now();
        updated.suspended_reason = `${updated.engine_restart_failures.length} auto-restart failures in ${BACKOFF_WINDOW_MS / 60000} min`;
        logSuspendedNotice(updated);
      }
      saveBackoffState(updated);
      throw err;
    }
  }

  writePids(pids);

  // MCP is Bun and binds in <100ms; 10s is plenty.
  // Engine is a PyInstaller bundle that extracts itself to /tmp/_MEI* on first
  // run (cold start ~12-15s on macOS). After the cache is warm, < 1s. Wait up
  // to 30s for the engine; running in parallel with MCP keeps the perceived
  // start time short on warm starts.
  const [mcp, engine] = await Promise.all([
    mcpAlreadyUp ? Promise.resolve(true) : waitForHealthPort(MCP_PORT, 10_000),
    engineAlreadyUp || engineBailedIdempotent
      ? Promise.resolve(true)
      : waitForHealthPort(ENGINE_PORT, 30_000),
  ]);

  // Fix the PID file: PyInstaller's bootloader (the PID we got from spawn())
  // execs/forks into the real Python interpreter, which gets a different PID.
  // The bootloader exits, lsof sees the inner process. Without this update,
  // doctor will report "PID drift" forever and `restart` won't fix it.
  if (engine && engineSpawned) {
    const realEnginePid = pidListeningOn(ENGINE_PORT);
    if (realEnginePid !== undefined && realEnginePid !== pids.engine) {
      pids.engine = realEnginePid;
      writePids(pids);
    }
  } else if (engine && engineBailedIdempotent) {
    // Picked up a healthy listener that was already there — record its PID.
    const realEnginePid = pidListeningOn(ENGINE_PORT);
    if (realEnginePid !== undefined) {
      pids.engine = realEnginePid;
      writePids(pids);
    }
  }

  // Engine tried to spawn but waitForHealthPort timed out → count as a failure.
  if (engineSpawned && !engine) {
    const updated = recordFailure(backoff, Date.now());
    if (shouldSuspend(updated.engine_restart_failures, BACKOFF_THRESHOLD)) {
      updated.suspended_at = Date.now();
      updated.suspended_reason = `${updated.engine_restart_failures.length} auto-restart failures in ${BACKOFF_WINDOW_MS / 60000} min`;
      logSuspendedNotice(updated);
    }
    saveBackoffState(updated);
  }

  return { mcp, engine, alreadyRunning: false };
}

/**
 * Clear the backoff state. Called by `beheld start` as the user's explicit
 * signal: "resume auto-restart". If there was anything to clear, logs it.
 */
export function clearBackoffStateOnUserStart(): void {
  const current = loadBackoffState();
  const hadFailures = current.engine_restart_failures.length > 0;
  const wasSuspended = isSuspended(current);
  if (hadFailures || wasSuspended) {
    saveBackoffState({ engine_restart_failures: [], suspended_at: null, suspended_reason: null });
    if (wasSuspended) {
      supervisorLog("auto-restart resumed (suspension cleared manually).");
    }
  }
}

export async function stop(): Promise<void> {
  const pids = readPids();
  for (const pid of [pids.mcp, pids.engine]) {
    if (!pid) continue;
    try {
      process.kill(pid, "SIGTERM");
      // Wait up to 5s for graceful exit
      let waited = 0;
      while (processAlive(pid) && waited < 5000) {
        await new Promise((r) => setTimeout(r, 200));
        waited += 200;
      }
      if (processAlive(pid)) process.kill(pid, "SIGKILL");
    } catch {
      // Already gone
    }
  }
  if (existsSync(pidFile())) rmSync(pidFile());
}

export async function isRunning(): Promise<boolean> {
  const [mcp, eng] = await Promise.all([isMcpRunning(), isEngineRunning()]);
  return mcp && eng;
}

// KeepAlive is false because `beheld start` exits once both daemons are up.
// launchd must not loop-restart a one-shot command.
export function generateLaunchAgentPlist(bin: string, devDir: string): string {
  const log = join(devDir, "daemon.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bin}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${log}</string>
  <key>StandardErrorPath</key>
  <string>${log}</string>
</dict>
</plist>`;
}

// Type=oneshot + RemainAfterExit because `beheld start` exits after launching
// both daemons. Without RemainAfterExit the unit would show as inactive immediately.
export function generateSystemdService(bin: string, _devDir: string): string {
  return `[Unit]
Description=Beheld daemons
After=default.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${bin} start

[Install]
WantedBy=default.target
`;
}

export async function installAutostart(): Promise<void> {
  const bin = existsSync(binaryPath()) ? binaryPath() : process.execPath;

  if (platform() === "darwin") {
    const plist = launchAgentPlistPath();
    await mkdir(dirname(plist), { recursive: true });
    await writeFile(plist, generateLaunchAgentPlist(bin, beheldDir()));
    // launchctl load is best-effort; ignore errors in non-interactive envs
    spawn("launchctl", ["load", "-w", plist], { stdio: "ignore" });
  } else if (platform() === "linux") {
    const unit = systemdUnitPath();
    await mkdir(dirname(unit), { recursive: true });
    await writeFile(unit, generateSystemdService(bin, beheldDir()));
    spawn("systemctl", ["--user", "enable", "--now", SYSTEMD_SERVICE_NAME], {
      stdio: "ignore",
    });
  }
}

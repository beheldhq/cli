import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Database } from "bun:sqlite";
import { start as daemonManagerStart } from "../daemon-manager";
import { pidListeningOn, waitSocketRelease as utilWaitSocketRelease } from "../util/ports";
import type { EngineCheck, ProcessingSnapshot } from "./doctor";

// ── public types ────────────────────────────────────────────────────────────

export interface HealEvidence {
  runtimePid: number;
  stat: string;
  cpuPct: number;
  etime: string;
  cursorLagMs: number;
}

export interface HealStep {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface HealReport {
  triggered: true;
  evidence: HealEvidence;
  steps: HealStep[];
  succeeded: boolean;
}

export interface HealProbes {
  captureStack?: (pid: number, outPath: string) => Promise<boolean>;
  killProcess?: (pid: number) => boolean;
  waitSocketRelease?: (port: number, timeoutMs: number) => Promise<boolean>;
  walCheckpoint?: (dbPath: string) => Promise<{ ok: boolean; detail?: string }>;
  clearStaleEnginePid?: () => boolean;
  restartDaemon?: () => Promise<{ ok: boolean; detail?: string }>;
  now?: () => number;
}

// ── path utilities ──────────────────────────────────────────────────────────

function beheldDir(): string {
  return process.env.BEHELD_DATA_DIR
    ? join(process.env.BEHELD_DATA_DIR, ".beheld")
    : join(homedir(), ".beheld");
}

function diagnosticsDir(): string {
  return join(beheldDir(), "diagnostics");
}

function pidFilePath(): string {
  return join(beheldDir(), "daemon.pid");
}

function profileDbPath(): string {
  return join(beheldDir(), "profile.db");
}

function enginePort(): number {
  const u = process.env.BEHELD_ENGINE_URL;
  if (!u) return 7338;
  try {
    const n = parseInt(new URL(u).port, 10);
    return Number.isFinite(n) && n > 0 ? n : 7338;
  } catch {
    return 7338;
  }
}

// ── default probe implementations ───────────────────────────────────────────

export async function captureStack(pid: number, outPath: string): Promise<boolean> {
  if (platform() === "darwin") {
    // `sample <pid> 3 -file <path>` — 3 seconds, saves directly to the path.
    const r = spawnSync("sample", [String(pid), "3", "-file", outPath], { stdio: "pipe" });
    if (r.status === 0 && existsSync(outPath)) {
      try {
        chmodSync(outPath, 0o600);
      } catch {
        /* best-effort */
      }
      return true;
    }
    return false;
  }
  if (platform() === "linux") {
    const which = spawnSync("which", ["py-spy"], { stdio: "pipe" });
    if (which.status !== 0) return false;
    const r = spawnSync("py-spy", ["dump", "--pid", String(pid)], { stdio: "pipe" });
    if (r.status === 0 && r.stdout && r.stdout.length > 0) {
      try {
        writeFileSync(outPath, r.stdout, { mode: 0o600 });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
  return false;
}

export function killProcess(pid: number): boolean {
  try {
    process.kill(pid, "SIGKILL");
    return true;
  } catch (e: unknown) {
    // ESRCH: already died on its own — not a failure from our perspective,
    // the subsequent cleanup still applies.
    if (typeof e === "object" && e && (e as { code?: string }).code === "ESRCH") {
      return true;
    }
    return false;
  }
}

export const waitSocketRelease = utilWaitSocketRelease;

export async function walCheckpoint(
  dbPath: string,
): Promise<{ ok: boolean; detail?: string }> {
  let db: Database | null = null;
  try {
    db = new Database(dbPath);
    // TRUNCATE = forces a full checkpoint + zeroes the WAL. If another process
    // is holding the DB (SQLITE_BUSY), throws — caller marks the step as warn
    // but continues to steps 6 and 7.
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: msg };
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
  }
}

export function clearStaleEnginePid(): boolean {
  const fp = pidFilePath();
  if (!existsSync(fp)) return true;
  try {
    const raw = readFileSync(fp, "utf8");
    const pids = JSON.parse(raw) as { mcp?: number; engine?: number };
    delete pids.engine;
    writeFileSync(fp, JSON.stringify(pids), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

export async function restartDaemon(): Promise<{ ok: boolean; detail?: string }> {
  // `start()` checks MCP + engine and spawns ONLY the ones that are down.
  // Since we just killed the engine and MCP is alive, only the engine is
  // re-spawned. Zero MCP downtime.
  try {
    const result = await daemonManagerStart();
    if (result.engine) return { ok: true };
    return { ok: false, detail: "engine did not come back on /health" };
  } catch (e: unknown) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

// ── orchestration ───────────────────────────────────────────────────────────

const STACK_DUMP_PREFIX = "busyloop-";
const SOCKET_RELEASE_TIMEOUT_MS = 2000;

// Best-effort steps: failures here don't count against `succeeded`. The real
// heal is kill+wait+wal+clear+restart; capturing the stack and preparing the
// diagnostics dir are auxiliary (useful for post-mortem, optional).
const BEST_EFFORT_STEPS = new Set(["prepare-diagnostics-dir", "capture-stack"]);

function makeAbortedStep(name: string): HealStep {
  return { name, ok: false, detail: "aborted due to previous failure" };
}

export async function selfHealEngine(
  engine: EngineCheck,
  snap: ProcessingSnapshot,
  probes: HealProbes = {},
): Promise<HealReport> {
  // Gate preconditions (defensive — caller already verified via
  // isInequivocalBusyLoop, but we keep the invariant explicit here too).
  if (engine.runtimePid === undefined || engine.proc === undefined || snap.cursor === null) {
    throw new Error("selfHealEngine called without busy-loop preconditions");
  }
  const newest = Math.max(...snap.sessions.map((s) => s.mtime));
  const cursorLagMs = newest - snap.cursor.mtime;
  const evidence: HealEvidence = {
    runtimePid: engine.runtimePid,
    stat: engine.proc.stat,
    cpuPct: engine.proc.cpuPct,
    etime: engine.proc.etime,
    cursorLagMs,
  };

  const _captureStack = probes.captureStack ?? captureStack;
  const _killProcess = probes.killProcess ?? killProcess;
  const _waitSocketRelease = probes.waitSocketRelease ?? waitSocketRelease;
  const _walCheckpoint = probes.walCheckpoint ?? walCheckpoint;
  const _clearStaleEnginePid = probes.clearStaleEnginePid ?? clearStaleEnginePid;
  const _restartDaemon = probes.restartDaemon ?? restartDaemon;
  const _now = probes.now ?? Date.now;

  const steps: HealStep[] = [];

  // 1. prepare-diagnostics-dir (best-effort)
  const dDir = diagnosticsDir();
  let dDirOk = false;
  try {
    mkdirSync(dDir, { recursive: true, mode: 0o700 });
    dDirOk = true;
    steps.push({ name: "prepare-diagnostics-dir", ok: true });
  } catch (e: unknown) {
    steps.push({
      name: "prepare-diagnostics-dir",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // 2. capture-stack (best-effort)
  let stackOk = false;
  let stackPath = "";
  if (dDirOk) {
    stackPath = join(dDir, `${STACK_DUMP_PREFIX}${_now()}.txt`);
    try {
      stackOk = await _captureStack(engine.runtimePid, stackPath);
      steps.push({
        name: "capture-stack",
        ok: stackOk,
        detail: stackOk ? stackPath : "sample/py-spy unavailable or failed",
      });
    } catch (e: unknown) {
      steps.push({
        name: "capture-stack",
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  } else {
    steps.push({
      name: "capture-stack",
      ok: false,
      detail: "diagnostics dir unavailable",
    });
  }

  // 3. kill-engine (FATAL if it fails)
  const killOk = _killProcess(engine.runtimePid);
  steps.push({
    name: "kill-engine",
    ok: killOk,
    detail: killOk ? `PID ${engine.runtimePid}` : "process.kill failed",
  });
  if (!killOk) {
    steps.push(makeAbortedStep("wait-socket-release"));
    steps.push(makeAbortedStep("wal-checkpoint"));
    steps.push(makeAbortedStep("clear-stale-engine-pid"));
    steps.push(makeAbortedStep("restart-daemon"));
    return { triggered: true, evidence, steps, succeeded: false };
  }

  // 4. wait-socket-release (FATAL if it fails)
  const releaseT0 = _now();
  const releaseOk = await _waitSocketRelease(enginePort(), SOCKET_RELEASE_TIMEOUT_MS);
  const releaseElapsed = _now() - releaseT0;
  steps.push({
    name: "wait-socket-release",
    ok: releaseOk,
    detail: releaseOk
      ? `released in ${releaseElapsed}ms`
      : `timeout after ${SOCKET_RELEASE_TIMEOUT_MS}ms`,
  });
  if (!releaseOk) {
    steps.push(makeAbortedStep("wal-checkpoint"));
    steps.push(makeAbortedStep("clear-stale-engine-pid"));
    steps.push(makeAbortedStep("restart-daemon"));
    return { triggered: true, evidence, steps, succeeded: false };
  }

  // 5. wal-checkpoint (NON-blocking — continues even on failure)
  const checkpoint = await _walCheckpoint(profileDbPath());
  steps.push({
    name: "wal-checkpoint",
    ok: checkpoint.ok,
    detail: checkpoint.detail,
  });

  // 6. clear-stale-engine-pid (NON-blocking)
  const clearOk = _clearStaleEnginePid();
  steps.push({
    name: "clear-stale-engine-pid",
    ok: clearOk,
  });

  // 7. restart-daemon (terminal)
  const restart = await _restartDaemon();
  steps.push({
    name: "restart-daemon",
    ok: restart.ok,
    detail: restart.detail,
  });

  const succeeded = steps.every((s) => s.ok || BEST_EFFORT_STEPS.has(s.name));
  return { triggered: true, evidence, steps, succeeded };
}

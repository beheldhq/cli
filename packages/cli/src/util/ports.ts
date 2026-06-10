import { spawnSync } from "node:child_process";

/**
 * Resolve the PID currently LISTENing on a TCP port via lsof.
 *
 * Why this is the supervisor's source of truth: the PID file at
 * `~/.beheld/daemon.pid` can be stale (process died on its own,
 * PyInstaller forked, etc.). The kernel knows exactly who holds the
 * socket — we ask it directly.
 *
 * Returns undefined if nothing is listening on the port, if lsof is
 * unavailable, or if the output doesn't match a valid integer.
 */
export function pidListeningOn(port: number): number | undefined {
  const res = spawnSync("lsof", ["-i", `:${port}`, "-P", "-n", "-sTCP:LISTEN", "-t"], {
    stdio: "pipe",
  });
  if (res.status !== 0) return undefined;
  const out = (res.stdout?.toString() ?? "").trim();
  if (!out) return undefined;
  const n = parseInt(out.split("\n")[0]!, 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Check whether the engine responds to /health quickly.
 *
 * Used in the supervisor's pre-bind cleanup: we need to decide in <2s
 * whether the current listener is healthy (idempotence — don't respawn
 * what works) or zombie (kill + relaunch). The `engineHealth` in
 * engine-client.ts uses a 3s timeout — fine for the doctor, too long here.
 */
export async function engineHealthy(port: number, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Wait until `pidListeningOn(port)` returns undefined, polling at 100ms.
 * Returns true if the socket was released within the timeout, false otherwise.
 */
export async function waitSocketRelease(port: number, timeoutMs: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pidListeningOn(port) === undefined) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return pidListeningOn(port) === undefined;
}

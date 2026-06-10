import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

let tmpDir: string;
const originalDataDir = process.env.BEHELD_DATA_DIR;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beheld-heal-"));
  process.env.BEHELD_DATA_DIR = tmpDir;
  fs.mkdirSync(path.join(tmpDir, ".beheld"), { recursive: true, mode: 0o700 });
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.BEHELD_DATA_DIR;
  else process.env.BEHELD_DATA_DIR = originalDataDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Helpers — minimal engine snapshot and processing snapshot for the gate.
function engineLike() {
  return {
    severity: "crit" as const,
    label: "Scoring engine (port 7338)",
    lines: [],
    runtimePid: 70859,
    proc: { stat: "R+", cpuPct: 541.4, etime: "06-16:42:35" },
  };
}

function snapLike(cursorMtime = 1_000, newest = 1_000 + 10 * 60 * 1000) {
  return {
    cursor: { offsets: { "s.jsonl": 100 }, mtime: cursorMtime },
    sessions: [{ name: "s.jsonl", size: 500, mtime: newest }],
    profileDb: { mtime: newest } as { mtime: number } | null,
    profileDbWal: { size: 1024 } as { size: number } | null,
  };
}

// ── Happy path ───────────────────────────────────────────────────────────────

describe("selfHealEngine — happy path", () => {
  test("all probes ok → succeeded:true and 7 steps recorded", async () => {
    const { selfHealEngine } = await import("../src/commands/heal-engine");
    const calls: string[] = [];
    const report = await selfHealEngine(engineLike(), snapLike(), {
      captureStack: async () => { calls.push("capture"); return true; },
      killProcess: () => { calls.push("kill"); return true; },
      waitSocketRelease: async () => { calls.push("wait"); return true; },
      walCheckpoint: async () => { calls.push("wal"); return { ok: true }; },
      clearStaleEnginePid: () => { calls.push("clear"); return true; },
      restartDaemon: async () => { calls.push("restart"); return { ok: true }; },
      now: () => 12345,
    });
    expect(report.triggered).toBe(true);
    expect(report.succeeded).toBe(true);
    expect(report.steps).toHaveLength(7);
    expect(report.steps.every((s) => s.ok)).toBe(true);
    // Call order must reflect the spec sequence.
    expect(calls).toEqual(["capture", "kill", "wait", "wal", "clear", "restart"]);
  });

  test("evidence reflects literal engine/snapshot values", async () => {
    const { selfHealEngine } = await import("../src/commands/heal-engine");
    const snap = snapLike(1_000, 1_000 + 7 * 60 * 1000); // 7 min lag
    const report = await selfHealEngine(engineLike(), snap, {
      captureStack: async () => true,
      killProcess: () => true,
      waitSocketRelease: async () => true,
      walCheckpoint: async () => ({ ok: true }),
      clearStaleEnginePid: () => true,
      restartDaemon: async () => ({ ok: true }),
    });
    expect(report.evidence).toEqual({
      runtimePid: 70859,
      stat: "R+",
      cpuPct: 541.4,
      etime: "06-16:42:35",
      cursorLagMs: 7 * 60 * 1000,
    });
  });
});

// ── Best-effort steps (stack, wal, clear) ────────────────────────────────────

describe("selfHealEngine — unavailable stack does not block", () => {
  test("captureStack=false → succeeded:true (best-effort does not count)", async () => {
    const { selfHealEngine } = await import("../src/commands/heal-engine");
    const report = await selfHealEngine(engineLike(), snapLike(), {
      captureStack: async () => false,
      killProcess: () => true,
      waitSocketRelease: async () => true,
      walCheckpoint: async () => ({ ok: true }),
      clearStaleEnginePid: () => true,
      restartDaemon: async () => ({ ok: true }),
    });
    const stackStep = report.steps.find((s) => s.name === "capture-stack")!;
    expect(stackStep.ok).toBe(false);
    expect(stackStep.detail).toBeTruthy();
    // Best-effort: failed capture-stack does NOT bring down succeeded — the 5
    // critical steps (kill/wait/wal/clear/restart) all ok keep the final verdict.
    expect(report.succeeded).toBe(true);
    expect(report.steps.find((s) => s.name === "kill-engine")!.ok).toBe(true);
    expect(report.steps.find((s) => s.name === "restart-daemon")!.ok).toBe(true);
  });
});

// ── Short-circuit on kill / wait ─────────────────────────────────────────────

describe("selfHealEngine — kill fails", () => {
  test("killProcess=false → 4–7 marked as 'aborted due to previous failure'", async () => {
    const { selfHealEngine } = await import("../src/commands/heal-engine");
    let walCalled = false;
    let restartCalled = false;
    const report = await selfHealEngine(engineLike(), snapLike(), {
      captureStack: async () => true,
      killProcess: () => false,
      waitSocketRelease: async () => true,
      walCheckpoint: async () => { walCalled = true; return { ok: true }; },
      clearStaleEnginePid: () => true,
      restartDaemon: async () => { restartCalled = true; return { ok: true }; },
    });
    expect(report.succeeded).toBe(false);
    expect(walCalled).toBe(false);
    expect(restartCalled).toBe(false);
    const aborted = report.steps.filter((s) => s.detail === "aborted due to previous failure");
    expect(aborted.map((s) => s.name)).toEqual([
      "wait-socket-release",
      "wal-checkpoint",
      "clear-stale-engine-pid",
      "restart-daemon",
    ]);
  });
});

describe("selfHealEngine — socket does not release", () => {
  test("waitSocketRelease=false → 5–7 aborted", async () => {
    const { selfHealEngine } = await import("../src/commands/heal-engine");
    let walCalled = false;
    const report = await selfHealEngine(engineLike(), snapLike(), {
      captureStack: async () => true,
      killProcess: () => true,
      waitSocketRelease: async () => false,
      walCheckpoint: async () => { walCalled = true; return { ok: true }; },
      clearStaleEnginePid: () => true,
      restartDaemon: async () => ({ ok: true }),
    });
    expect(report.succeeded).toBe(false);
    expect(walCalled).toBe(false);
    const aborted = report.steps.filter((s) => s.detail === "aborted due to previous failure");
    expect(aborted.map((s) => s.name)).toEqual([
      "wal-checkpoint",
      "clear-stale-engine-pid",
      "restart-daemon",
    ]);
  });
});

// ── WAL failure does not block 6 and 7 ───────────────────────────────────────

describe("selfHealEngine — WAL checkpoint fails", () => {
  test("walCheckpoint={ok:false} → clear and restart continue", async () => {
    const { selfHealEngine } = await import("../src/commands/heal-engine");
    let clearCalled = false;
    let restartCalled = false;
    const report = await selfHealEngine(engineLike(), snapLike(), {
      captureStack: async () => true,
      killProcess: () => true,
      waitSocketRelease: async () => true,
      walCheckpoint: async () => ({ ok: false, detail: "SQLITE_BUSY" }),
      clearStaleEnginePid: () => { clearCalled = true; return true; },
      restartDaemon: async () => { restartCalled = true; return { ok: true }; },
    });
    expect(clearCalled).toBe(true);
    expect(restartCalled).toBe(true);
    expect(report.steps.find((s) => s.name === "wal-checkpoint")!.ok).toBe(false);
    expect(report.steps.find((s) => s.name === "clear-stale-engine-pid")!.ok).toBe(true);
    expect(report.steps.find((s) => s.name === "restart-daemon")!.ok).toBe(true);
    expect(report.succeeded).toBe(false); // succeeded = all ok
  });
});

// ── Restart fails ────────────────────────────────────────────────────────────

describe("selfHealEngine — restart fails", () => {
  test("restartDaemon={ok:false} → previous steps ok, succeeded:false", async () => {
    const { selfHealEngine } = await import("../src/commands/heal-engine");
    const report = await selfHealEngine(engineLike(), snapLike(), {
      captureStack: async () => true,
      killProcess: () => true,
      waitSocketRelease: async () => true,
      walCheckpoint: async () => ({ ok: true }),
      clearStaleEnginePid: () => true,
      restartDaemon: async () => ({ ok: false, detail: "engine did not respond" }),
    });
    expect(report.succeeded).toBe(false);
    expect(report.steps.find((s) => s.name === "restart-daemon")!.ok).toBe(false);
    // Everything before restart stayed ok.
    const before = report.steps.filter((s) => s.name !== "restart-daemon");
    expect(before.every((s) => s.ok)).toBe(true);
  });
});

// ── clearStaleEnginePid (default) ────────────────────────────────────────────

describe("clearStaleEnginePid (default)", () => {
  test("preserves mcp field when removing engine", async () => {
    fs.writeFileSync(
      path.join(tmpDir, ".beheld", "daemon.pid"),
      JSON.stringify({ mcp: 100, engine: 18518 }),
    );
    const { clearStaleEnginePid } = await import("../src/commands/heal-engine");
    expect(clearStaleEnginePid()).toBe(true);
    const after = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".beheld", "daemon.pid"), "utf8"),
    );
    expect(after).toEqual({ mcp: 100 });
  });

  test("missing file returns true (nothing to clear)", async () => {
    const { clearStaleEnginePid } = await import("../src/commands/heal-engine");
    expect(clearStaleEnginePid()).toBe(true);
  });
});

// ── walCheckpoint (default) ──────────────────────────────────────────────────

describe("walCheckpoint (default)", () => {
  test("runs on a valid DB and returns ok:true", async () => {
    const { Database } = await import("bun:sqlite");
    const dbPath = path.join(tmpDir, ".beheld", "profile.db");
    const setup = new Database(dbPath);
    setup.exec("PRAGMA journal_mode=WAL; CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1);");
    setup.close();

    const { walCheckpoint } = await import("../src/commands/heal-engine");
    const r = await walCheckpoint(dbPath);
    expect(r.ok).toBe(true);
  });

  test("missing DB creates empty file and returns ok:true (bun:sqlite creates)", async () => {
    // bun:sqlite creates the file if it does not exist; checkpoint on an empty WAL is a no-op
    // and returns ok. This is the acceptable degradation defined in the design.
    const { walCheckpoint } = await import("../src/commands/heal-engine");
    const r = await walCheckpoint(path.join(tmpDir, ".beheld", "ghost.db"));
    expect(r.ok).toBe(true);
  });
});

// ── Gate preconditions (defensive) ───────────────────────────────────────────

describe("selfHealEngine — invariants", () => {
  test("missing runtimePid → throw", async () => {
    const { selfHealEngine } = await import("../src/commands/heal-engine");
    const e = engineLike() as { runtimePid?: number };
    delete e.runtimePid;
    await expect(selfHealEngine(e as never, snapLike())).rejects.toThrow();
  });

  test("missing proc → throw", async () => {
    const { selfHealEngine } = await import("../src/commands/heal-engine");
    const e = engineLike() as { proc?: unknown };
    delete e.proc;
    await expect(selfHealEngine(e as never, snapLike())).rejects.toThrow();
  });

  test("snap.cursor null → throw", async () => {
    const { selfHealEngine } = await import("../src/commands/heal-engine");
    const snap = snapLike();
    snap.cursor = null as never;
    await expect(selfHealEngine(engineLike(), snap)).rejects.toThrow();
  });
});

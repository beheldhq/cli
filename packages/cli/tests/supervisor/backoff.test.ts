import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

let tmpDir: string;
const originalDataDir = process.env.BEHELD_DATA_DIR;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beheld-backoff-"));
  process.env.BEHELD_DATA_DIR = tmpDir;
  // We don't pre-create ~/.beheld/ here to verify saveBackoffState creates it.
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.BEHELD_DATA_DIR;
  else process.env.BEHELD_DATA_DIR = originalDataDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── pruneStaleFailures (pure) ────────────────────────────────────────────────

describe("pruneStaleFailures", () => {
  test("[] → []", async () => {
    const { pruneStaleFailures } = await import("../../src/supervisor/backoff");
    expect(pruneStaleFailures([], 1000, 500)).toEqual([]);
  });

  test("removes timestamps outside the window", async () => {
    const { pruneStaleFailures } = await import("../../src/supervisor/backoff");
    // window = [now - window, now] = [500, 1000]; 100 is outside.
    expect(pruneStaleFailures([100, 500, 800], 1000, 500)).toEqual([500, 800]);
  });

  test("window wide enough → keeps all", async () => {
    const { pruneStaleFailures } = await import("../../src/supervisor/backoff");
    expect(pruneStaleFailures([100, 500, 800], 1000, 1000)).toEqual([100, 500, 800]);
  });
});

// ── shouldSuspend (pure) ─────────────────────────────────────────────────────

describe("shouldSuspend", () => {
  test("[] / threshold=3 → false", async () => {
    const { shouldSuspend } = await import("../../src/supervisor/backoff");
    expect(shouldSuspend([], 3)).toBe(false);
  });

  test("2 failures / threshold=3 → false", async () => {
    const { shouldSuspend } = await import("../../src/supervisor/backoff");
    expect(shouldSuspend([1, 2], 3)).toBe(false);
  });

  test("3 failures / threshold=3 → true (>= is the boundary)", async () => {
    const { shouldSuspend } = await import("../../src/supervisor/backoff");
    expect(shouldSuspend([1, 2, 3], 3)).toBe(true);
  });

  test("4 failures / threshold=3 → true", async () => {
    const { shouldSuspend } = await import("../../src/supervisor/backoff");
    expect(shouldSuspend([1, 2, 3, 4], 3)).toBe(true);
  });
});

// ── recordFailure (pure) ─────────────────────────────────────────────────────

describe("recordFailure", () => {
  test("adds timestamp and prunes window", async () => {
    const { recordFailure, BACKOFF_WINDOW_MS } = await import("../../src/supervisor/backoff");
    const state = {
      engine_restart_failures: [100],
      suspended_at: null,
      suspended_reason: null,
    };
    const now = 100 + BACKOFF_WINDOW_MS + 1; // 100 falls outside the window
    const updated = recordFailure(state, now);
    expect(updated.engine_restart_failures).toEqual([now]);
  });

  test("does not modify suspended_at", async () => {
    const { recordFailure } = await import("../../src/supervisor/backoff");
    const state = {
      engine_restart_failures: [],
      suspended_at: 999,
      suspended_reason: "x",
    };
    const updated = recordFailure(state, 1000);
    expect(updated.suspended_at).toBe(999);
    expect(updated.suspended_reason).toBe("x");
  });
});

// ── clearBackoff (pure) ──────────────────────────────────────────────────────

describe("clearBackoff", () => {
  test("returns default zeroed state", async () => {
    const { clearBackoff } = await import("../../src/supervisor/backoff");
    expect(clearBackoff()).toEqual({
      engine_restart_failures: [],
      suspended_at: null,
      suspended_reason: null,
    });
  });
});

// ── isSuspended (pure) ───────────────────────────────────────────────────────

describe("isSuspended", () => {
  test("suspended_at === null → false", async () => {
    const { isSuspended } = await import("../../src/supervisor/backoff");
    expect(isSuspended({ engine_restart_failures: [], suspended_at: null, suspended_reason: null })).toBe(false);
  });

  test("suspended_at === <ts> → true", async () => {
    const { isSuspended } = await import("../../src/supervisor/backoff");
    expect(isSuspended({ engine_restart_failures: [], suspended_at: 12345, suspended_reason: "x" })).toBe(true);
  });
});

// ── loadBackoffState / saveBackoffState (persistence) ────────────────────────

describe("loadBackoffState", () => {
  test("missing file → default state", async () => {
    const { loadBackoffState } = await import("../../src/supervisor/backoff");
    expect(loadBackoffState()).toEqual({
      engine_restart_failures: [],
      suspended_at: null,
      suspended_reason: null,
    });
  });

  test("corrupted JSON → default state without crashing", async () => {
    fs.mkdirSync(path.join(tmpDir, ".beheld"), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(tmpDir, ".beheld", "supervisor-backoff.json"), "{ not json");
    const { loadBackoffState } = await import("../../src/supervisor/backoff");
    expect(loadBackoffState()).toEqual({
      engine_restart_failures: [],
      suspended_at: null,
      suspended_reason: null,
    });
  });

  test("defensive validation ignores fields with wrong shape", async () => {
    fs.mkdirSync(path.join(tmpDir, ".beheld"), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(tmpDir, ".beheld", "supervisor-backoff.json"),
      JSON.stringify({
        engine_restart_failures: [1, "bad", 3],
        suspended_at: "not-a-number",
        suspended_reason: 999,
      }),
    );
    const { loadBackoffState } = await import("../../src/supervisor/backoff");
    const state = loadBackoffState();
    expect(state.engine_restart_failures).toEqual([1, 3]);
    expect(state.suspended_at).toBeNull();
    expect(state.suspended_reason).toBeNull();
  });
});

describe("saveBackoffState", () => {
  test("save + load = idempotent roundtrip", async () => {
    const { saveBackoffState, loadBackoffState } = await import("../../src/supervisor/backoff");
    const original = {
      engine_restart_failures: [100, 200, 300],
      suspended_at: 12345,
      suspended_reason: "test",
    };
    saveBackoffState(original);
    expect(loadBackoffState()).toEqual(original);
  });

  test("creates ~/.beheld/ if missing", async () => {
    const { saveBackoffState } = await import("../../src/supervisor/backoff");
    expect(fs.existsSync(path.join(tmpDir, ".beheld"))).toBe(false);
    saveBackoffState({ engine_restart_failures: [], suspended_at: null, suspended_reason: null });
    expect(fs.existsSync(path.join(tmpDir, ".beheld"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".beheld", "supervisor-backoff.json"))).toBe(true);
  });

  test("file written with mode 0o600", async () => {
    const { saveBackoffState } = await import("../../src/supervisor/backoff");
    saveBackoffState({ engine_restart_failures: [], suspended_at: null, suspended_reason: null });
    const stat = fs.statSync(path.join(tmpDir, ".beheld", "supervisor-backoff.json"));
    // mask for the 9 perm bits (rwxrwxrwx).
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

// ── End-to-end scenario ──────────────────────────────────────────────────────

describe("End-to-end scenario — 3 failures in 5 min suspend", () => {
  test("recordFailure × 3 → shouldSuspend → save → load preserves suspended_at", async () => {
    const {
      loadBackoffState,
      saveBackoffState,
      recordFailure,
      shouldSuspend,
      isSuspended,
      BACKOFF_THRESHOLD,
    } = await import("../../src/supervisor/backoff");

    let state = loadBackoffState();
    const t0 = 1_000_000;

    // 3 consecutive failures within the window.
    state = recordFailure(state, t0);
    expect(shouldSuspend(state.engine_restart_failures, BACKOFF_THRESHOLD)).toBe(false);
    state = recordFailure(state, t0 + 10_000);
    expect(shouldSuspend(state.engine_restart_failures, BACKOFF_THRESHOLD)).toBe(false);
    state = recordFailure(state, t0 + 20_000);
    expect(shouldSuspend(state.engine_restart_failures, BACKOFF_THRESHOLD)).toBe(true);

    // Caller triggers the transition to suspended_at.
    state.suspended_at = t0 + 20_001;
    state.suspended_reason = "test";
    saveBackoffState(state);

    // Next supervisor "boot" loads the suspended state.
    const reloaded = loadBackoffState();
    expect(isSuspended(reloaded)).toBe(true);
    expect(reloaded.suspended_at).toBe(t0 + 20_001);
  });

  test("clearBackoff resets everything (user signal via beheld start)", async () => {
    const { saveBackoffState, loadBackoffState, clearBackoff } = await import("../../src/supervisor/backoff");
    saveBackoffState({
      engine_restart_failures: [1, 2, 3],
      suspended_at: 100,
      suspended_reason: "x",
    });
    const cleared = clearBackoff();
    saveBackoffState(cleared);
    expect(loadBackoffState()).toEqual({
      engine_restart_failures: [],
      suspended_at: null,
      suspended_reason: null,
    });
  });

  test("2 falhas, 6 min passam, próxima falha → janela limpa, contador = 1", async () => {
    const { recordFailure, shouldSuspend, BACKOFF_WINDOW_MS, BACKOFF_THRESHOLD } = await import("../../src/supervisor/backoff");
    let state = {
      engine_restart_failures: [] as number[],
      suspended_at: null,
      suspended_reason: null,
    };
    const t0 = 1_000_000;
    state = recordFailure(state, t0);
    state = recordFailure(state, t0 + 60_000); // +1min
    expect(state.engine_restart_failures.length).toBe(2);
    // 6 min depois da última falha → ambas saem da janela.
    const later = t0 + 60_000 + BACKOFF_WINDOW_MS + 60_000;
    state = recordFailure(state, later);
    // Só a nova permanece.
    expect(state.engine_restart_failures).toEqual([later]);
    expect(shouldSuspend(state.engine_restart_failures, BACKOFF_THRESHOLD)).toBe(false);
  });
});

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── public types ─────────────────────────────────────────────────────────────

export interface SupervisorBackoffState {
  /** Timestamps (ms epoch) of auto-restart failures, ascending. */
  engine_restart_failures: number[];
  /** When the suspension fired (ms epoch); null = active. */
  suspended_at: number | null;
  /** Human-readable reason for the suspension. */
  suspended_reason: string | null;
}

// ── constants (exported for integration + tests) ─────────────────────────────

export const BACKOFF_WINDOW_MS = 5 * 60 * 1000; // 5 min
export const BACKOFF_THRESHOLD = 3;             // 3 failures

// ── default state ────────────────────────────────────────────────────────────

function defaultState(): SupervisorBackoffState {
  return {
    engine_restart_failures: [],
    suspended_at: null,
    suspended_reason: null,
  };
}

// ── paths ────────────────────────────────────────────────────────────────────

function beheldDir(): string {
  return process.env.BEHELD_DATA_DIR
    ? join(process.env.BEHELD_DATA_DIR, ".beheld")
    : join(homedir(), ".beheld");
}

export function backoffStatePath(): string {
  return join(beheldDir(), "supervisor-backoff.json");
}

// ── pure functions ───────────────────────────────────────────────────────────

/**
 * Drop timestamps outside the window [now - windowMs, now].
 * Pure — does not mutate the input array.
 */
export function pruneStaleFailures(
  failures: number[],
  now: number,
  windowMs: number,
): number[] {
  const cutoff = now - windowMs;
  return failures.filter((t) => t >= cutoff);
}

/**
 * Decide whether backoff should fire.
 * Pure — just counts elements.
 */
export function shouldSuspend(failures: number[], threshold: number): boolean {
  return failures.length >= threshold;
}

/**
 * Append a failure (with `now`) and prune timestamps outside the window.
 * Does NOT touch suspended_at — that transition is the caller's job.
 * Pure — returns a new state.
 */
export function recordFailure(
  state: SupervisorBackoffState,
  now: number,
): SupervisorBackoffState {
  const failures = pruneStaleFailures(
    [...state.engine_restart_failures, now],
    now,
    BACKOFF_WINDOW_MS,
  );
  return {
    ...state,
    engine_restart_failures: failures,
  };
}

/**
 * Clean state — used by `beheld start` to resume auto-restart.
 * Pure.
 */
export function clearBackoff(): SupervisorBackoffState {
  return defaultState();
}

/**
 * Suspended iff suspended_at !== null.
 * Pure.
 */
export function isSuspended(state: SupervisorBackoffState): boolean {
  return state.suspended_at !== null;
}

// ── persistence (impure, testable with BEHELD_DATA_DIR) ──────────────────────

/**
 * Load state from ~/.beheld/supervisor-backoff.json.
 * Missing file or invalid JSON → return default state without crashing.
 */
export function loadBackoffState(): SupervisorBackoffState {
  const fp = backoffStatePath();
  if (!existsSync(fp)) return defaultState();
  try {
    const raw = JSON.parse(readFileSync(fp, "utf8")) as Partial<SupervisorBackoffState>;
    // Defensive validation — only fields with a known shape.
    const failures = Array.isArray(raw.engine_restart_failures)
      ? raw.engine_restart_failures.filter((t): t is number => typeof t === "number")
      : [];
    return {
      engine_restart_failures: failures,
      suspended_at: typeof raw.suspended_at === "number" ? raw.suspended_at : null,
      suspended_reason: typeof raw.suspended_reason === "string" ? raw.suspended_reason : null,
    };
  } catch {
    return defaultState();
  }
}

/**
 * Persist state to ~/.beheld/supervisor-backoff.json at mode 0o600.
 * Creates ~/.beheld/ if missing (mode 0o700) — daemon-manager pattern.
 */
export function saveBackoffState(state: SupervisorBackoffState): void {
  mkdirSync(beheldDir(), { recursive: true, mode: 0o700 });
  writeFileSync(backoffStatePath(), JSON.stringify(state), { mode: 0o600 });
}

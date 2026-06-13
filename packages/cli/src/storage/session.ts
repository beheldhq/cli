/**
 * Persistent DevSession bearer token store at `~/.beheld/session.json`.
 *
 * Module 2A — `cli/bearer-token-persistence`. Foundation for any
 * authenticated CLI feature talking to the portal API (notify channel,
 * future admin commands, etc).
 *
 * Why a separate file from `config.json`:
 * - Credential vs preference. Config is preferences; session is a secret.
 * - Wipe semantics differ. `logout` clears session.json without touching
 *   user config. Future audit/rotation tools can target this file alone.
 *
 * Spec canônica: produto/analise/analise-email-comunicacao.md (rodada 5).
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SESSION_SCHEMA_VERSION = 1 as const;

/** Bearer session captured from a successful `POST /api/v1/auth/verify`. */
export interface PersistedSession {
  schema_version: 1;
  /** DevSession.token — opaque, 64-hex by convention. */
  token: string;
  /** Hex Ed25519 fingerprint that minted this token. Used to detect that the
   *  on-disk keypair changed underneath us (different machine, key rotated). */
  fingerprint: string;
  /** API base the token is valid against (production vs development). */
  api_base: string;
  /** ISO 8601 — local clock at receive time. */
  created_at: string;
  /** ISO 8601 — server's `expires_at`. */
  expires_at: string;
}

/** ~/.beheld/, respecting BEHELD_DATA_DIR like the rest of the CLI. */
export function beheldDir(): string {
  return process.env.BEHELD_DATA_DIR
    ? join(process.env.BEHELD_DATA_DIR, ".beheld")
    : join(homedir(), ".beheld");
}

export function sessionPath(baseDir?: string): string {
  return join(baseDir ?? beheldDir(), "session.json");
}

/** Read the persisted session. Returns null on missing file or any read/parse
 *  failure — callers treat "no session" and "broken session" the same:
 *  trigger a fresh auth flow. */
export function readSession(baseDir?: string): PersistedSession | null {
  const path = sessionPath(baseDir);
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedSession>;

    if (parsed.schema_version !== SESSION_SCHEMA_VERSION) return null;
    if (typeof parsed.token !== "string" || parsed.token.length === 0) return null;
    if (typeof parsed.fingerprint !== "string") return null;
    if (typeof parsed.api_base !== "string") return null;
    if (typeof parsed.expires_at !== "string") return null;
    if (typeof parsed.created_at !== "string") return null;

    return parsed as PersistedSession;
  } catch {
    return null;
  }
}

/** Persist the session. Creates `~/.beheld/` (mode 0700) if missing. File
 *  written with mode 0600 — credential, not preference. */
export function writeSession(session: PersistedSession, baseDir?: string): void {
  const dir = baseDir ?? beheldDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const path = sessionPath(baseDir);
  writeFileSync(path, JSON.stringify(session, null, 2), { mode: 0o600 });
  // Belt-and-suspenders: chmod even if writeFileSync's mode was overridden
  // by an umask on some platforms.
  chmodSync(path, 0o600);
}

/** Idempotent. Used by `logout` and by callers that detect a stale token. */
export function clearSession(baseDir?: string): void {
  const path = sessionPath(baseDir);
  if (existsSync(path)) rmSync(path);
}

/** True when the session is missing or its `expires_at` is in the past. */
export function isSessionExpired(
  session: PersistedSession | null,
  now: Date = new Date(),
): boolean {
  if (!session) return true;
  const expiresAt = new Date(session.expires_at).getTime();
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt <= now.getTime();
}

/** Test helper — assert the on-disk file mode is 0600. Returns the numeric
 *  mode masked to 0o777 so platform-specific high bits don't trip equality. */
export function sessionFileMode(baseDir?: string): number | null {
  const path = sessionPath(baseDir);
  if (!existsSync(path)) return null;
  return statSync(path).mode & 0o777;
}

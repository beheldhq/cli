/**
 * Cross-repo install counter.
 *
 * At most one SUCCESSFUL request per install lifetime:
 *   POST https://beheld.dev/api/install/register
 *   { id: <uuid-v4>, os: <"macos"|"linux">, version: <semver> }
 *
 * Two-file state machine in ~/.beheld/:
 *   - install-id              → stable identity UUID (mode 0o600, written first)
 *   - install-id.registered   → marker written only after server returns 204/429
 *
 * State transitions on `beheld init`:
 *   - Neither exists       → fresh install: generate UUID, write install-id,
 *                            POST, on success write the marker.
 *   - install-id exists,   → previous POST never completed (offline / 5xx).
 *     marker missing         Retry the POST with the SAME UUID. Server uses
 *                            find_or_create_by!, so retries are idempotent.
 *   - Both exist           → already registered. No-op.
 *
 * How to disable:
 *   BEHELD_NO_TELEMETRY=1 → nothing is sent, nothing is written, nothing
 *   appears in the init output. Invisible opt-out.
 *
 * POST failures never interrupt the install. The install-id file is written
 * before the POST so the UUID is stable across retry attempts; the
 * .registered marker is the success sentinel that stops future retries.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { getApiBaseUrl } from "../config/env";

/**
 * Public beheld endpoint base. Resolved by the central env module:
 * `BEHELD_ENV=production` (default) → `https://beheld.dev`;
 * `BEHELD_ENV=development` → `http://localhost:3000`.
 * Individual `BEHELD_API_URL` override takes precedence.
 */
export const DEFAULT_API_BASE = "https://beheld.dev";
export const REQUEST_TIMEOUT_MS = 3_000;

export function getApiBase(): string {
  return getApiBaseUrl();
}

export function registerUrl(): string {
  return `${getApiBase()}/api/install/register`;
}

export interface RegisterPayload {
  id: string;
  os: "macos" | "linux";
  version: string;
}

export interface RegisterResult {
  sent: boolean;
  reason?: string;
}

// ── paths ────────────────────────────────────────────────────────────────────

function beheldDir(): string {
  return process.env.BEHELD_DATA_DIR
    ? join(process.env.BEHELD_DATA_DIR, ".beheld")
    : join(homedir(), ".beheld");
}

export function installIdPath(): string {
  return join(beheldDir(), "install-id");
}

export function registeredMarkerPath(): string {
  return join(beheldDir(), "install-id.registered");
}

// ── environment detection ────────────────────────────────────────────────────

export function getOsTag(): "macos" | "linux" | null {
  const p = platform();
  if (p === "darwin") return "macos";
  if (p === "linux") return "linux";
  // Other platforms (windows, freebsd, etc.) are unsupported and do not
  // register. Consistent with the disclosure: the counter only measures macos|linux.
  return null;
}

export function isOptedOut(): boolean {
  const v = process.env.BEHELD_NO_TELEMETRY;
  if (v === undefined || v === "") return false;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

export function isAlreadyRegistered(): boolean {
  return existsSync(installIdPath()) && existsSync(registeredMarkerPath());
}

export function needsRegistration(): boolean {
  return !isAlreadyRegistered();
}

// ── payload build + send ─────────────────────────────────────────────────────

/**
 * Builds the payload to POST. If `install-id` already exists on disk (a
 * previous attempt that didn't reach the .registered marker), the existing
 * UUID is reused — so the server's idempotency (find_or_create_by!) is
 * what guarantees we never double-count.
 */
export function getRegisterPayload(version: string): RegisterPayload | null {
  const os = getOsTag();
  if (os === null) return null;
  return {
    id: readExistingInstallId() ?? randomUUID(),
    os,
    version,
  };
}

function readExistingInstallId(): string | null {
  try {
    const raw = readFileSync(installIdPath(), "utf8").trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Writes ~/.beheld/install-id BEFORE the network call (stable identity for
 * any future retry), then POSTs to /api/install/register. On a successful
 * response (204 or 429), drops a `.registered` marker so subsequent inits
 * don't retry. If the POST fails, the marker is NOT written and the next
 * `beheld init` will retry with the same UUID.
 */
export async function registerFirstInstall(
  payload: RegisterPayload,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<RegisterResult> {
  // 1. Ensure ~/.beheld/ exists (mode 0o700 — project default).
  try {
    mkdirSync(beheldDir(), { recursive: true, mode: 0o700 });
  } catch {
    // If even the dir cannot be created, there's no way to write; abort silently.
    return { sent: false, reason: "beheld dir inaccessible" };
  }

  // 2. Write install-id first. Stable identity is what makes retries safe:
  // the server is idempotent on this UUID, so re-POSTing never double-counts.
  try {
    writeFileSync(installIdPath(), payload.id, { mode: 0o600 });
  } catch (err) {
    return {
      sent: false,
      reason: err instanceof Error ? err.message : "write failed",
    };
  }

  // 3. POST. Failures do not block the install — they just leave the
  // .registered marker unwritten, so the next init retries.
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetchImpl(registerUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    // 204 = success. 429 = rate limit, treated as silent success by design.
    if (res.ok || res.status === 429) {
      markRegistered();
      return { sent: true };
    }
    // 4xx/5xx: leave .registered absent so next init retries.
    return { sent: false, reason: `HTTP ${res.status}` };
  } catch (err) {
    return {
      sent: false,
      reason: err instanceof Error ? err.message : "network failed",
    };
  }
}

function markRegistered(): void {
  try {
    writeFileSync(registeredMarkerPath(), "", { mode: 0o600 });
  } catch {
    // Marker write failure is non-fatal: worst case is one extra retry on
    // the next init, which the server idempotency absorbs.
  }
}

/**
 * Cross-repo install counter.
 *
 * One single request per install lifetime:
 *   POST https://beheld.dev/api/install/register
 *   { id: <uuid-v4>, os: <"macos"|"linux">, version: <semver> }
 *
 * How it works:
 *   - On the first install run we generate a UUID and write it to
 *     ~/.beheld/install-id (mode 0o600).
 *   - The file IS the source of truth. Its presence = "already registered".
 *   - Updates and reinstalls don't touch the file or re-post.
 *   - rm -rf ~/.beheld/ deletes it and the next init counts as a new install;
 *     rare and acceptable.
 *
 * How to disable:
 *   BEHELD_NO_TELEMETRY=1 → nothing is sent, nothing is written, nothing
 *   appears in the init output. Invisible opt-out.
 *
 * POST failures never interrupt the install. The file is written EVEN if
 * the network fails — so the second run never tries again. No retry.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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

export function isFirstInstall(): boolean {
  return !existsSync(installIdPath());
}

// ── payload build + send ─────────────────────────────────────────────────────

export function getRegisterPayload(version: string): RegisterPayload | null {
  const os = getOsTag();
  if (os === null) return null;
  return {
    id: randomUUID(),
    os,
    version,
  };
}

/**
 * Writes ~/.beheld/install-id BEFORE any network call. The file's presence
 * defines "already registered" — POST failure does not cause retry, and
 * POST success is not required to avoid duplication.
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

  // 2. Write the file FIRST. This is the critical invariant.
  try {
    writeFileSync(installIdPath(), payload.id, { mode: 0o600 });
  } catch (err) {
    return {
      sent: false,
      reason: err instanceof Error ? err.message : "write failed",
    };
  }

  // 3. Fire-and-forget POST. Failures do not block the install.
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
    // Other 4xx/5xx: the file is already written, so no retry — just report.
    if (res.ok || res.status === 429) {
      return { sent: true };
    }
    return { sent: false, reason: `HTTP ${res.status}` };
  } catch (err) {
    return {
      sent: false,
      reason: err instanceof Error ? err.message : "network failed",
    };
  }
}

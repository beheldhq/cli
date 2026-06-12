/**
 * Read + hash for the install-id file (~/.beheld/install-id).
 *
 * The id itself is a UUID-v4 written by `beheld bootstrap` on first run
 * (see install/counter.ts). We never publish the raw UUID anywhere — for
 * the anonymous platform ping we send sha256(install-id) so PostHog cannot
 * cross-reference with the install registry payload (which sends the raw
 * UUID).
 *
 * Returns `null` when the file is missing, which happens before bootstrap
 * has run. The active-day ping treats this as "no ping" — silent, no
 * crash.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

function beheldDir(): string {
  return process.env.BEHELD_DATA_DIR
    ? join(process.env.BEHELD_DATA_DIR, ".beheld")
    : join(homedir(), ".beheld");
}

export function installIdPath(): string {
  return join(beheldDir(), "install-id");
}

export async function readInstallId(): Promise<string | null> {
  try {
    const raw = await readFile(installIdPath(), "utf8");
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export function hashInstallId(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

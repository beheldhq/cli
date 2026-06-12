/**
 * Single source of truth for "is the daily ping allowed right now?".
 *
 * The ping is disabled if any of these is true:
 *   - BEHELD_NO_TELEMETRY=1 in the environment
 *   - BEHELD_DEBUG=1 in the environment (developer machine)
 *   - NODE_ENV === "test" (test harness)
 *   - config.telemetry.consent !== "granted" (user opted out or never
 *     answered the init prompt)
 *
 * Used by the active-day hook in src/index.ts and by `beheld telemetry
 * status` to print a single human-readable reason.
 */
import type { BeheldConfig } from "../types";

export type TelemetryDisabledReason =
  | "env-no-telemetry"
  | "env-debug"
  | "env-test"
  | "consent-denied"
  | "consent-unset";

export function telemetryDisabledReason(config: BeheldConfig | null): TelemetryDisabledReason | null {
  if (process.env.BEHELD_NO_TELEMETRY === "1") return "env-no-telemetry";
  if (process.env.BEHELD_DEBUG === "1") return "env-debug";
  if (process.env.NODE_ENV === "test") return "env-test";
  const consent = config?.telemetry?.consent;
  if (consent === "denied") return "consent-denied";
  if (consent !== "granted") return "consent-unset";
  return null;
}

export function isTelemetryDisabled(config: BeheldConfig | null): boolean {
  return telemetryDisabledReason(config) !== null;
}

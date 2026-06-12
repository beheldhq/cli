/**
 * Minimal PostHog capture client. No SDK — just a fetch.
 *
 * The project key (phc_*) is a write-only token, designed by PostHog to
 * be embedded in client code. Override via POSTHOG_CLI_KEY env var (used
 * by tests and by maintainers pointing at a staging project).
 *
 * Privacy invariants enforced here:
 *   - Only the four event properties listed below are ever sent. No path,
 *     no command, no error, no duration, no PII.
 *   - 2-second timeout — the ping never blocks the user's command.
 *   - Errors are swallowed. Telemetry MUST NOT surface to the user.
 *
 * If POSTHOG_CLI_KEY is absent (e.g. development builds without the key
 * baked in), `capture` is a no-op.
 */
import { VERSION } from "../version";

const POSTHOG_HOST = process.env.POSTHOG_HOST ?? "https://eu.posthog.com";
const DEFAULT_POSTHOG_CLI_KEY = "phc_wUQspu4VGirApYYEu6JKVcZZ9jJsVTRngzCHSxFHQiiv";
const REQUEST_TIMEOUT_MS = 2_000;

export type TelemetryEvent = "cli_installed" | "cli_active_day";

export interface CaptureInput {
  distinctId: string;
  event: TelemetryEvent;
  /** Overrides the embedded key. Used by tests. */
  apiKey?: string;
  /** Overrides fetch. Used by tests. */
  fetchImpl?: typeof fetch;
}

export interface TelemetryPayload {
  api_key: string;
  event: TelemetryEvent;
  distinct_id: string;
  properties: {
    version: string;
    os: NodeJS.Platform;
    arch: string;
    $lib: "beheld-cli";
  };
  timestamp: string;
}

export function buildPayload(distinctId: string, event: TelemetryEvent, apiKey: string): TelemetryPayload {
  return {
    api_key: apiKey,
    event,
    distinct_id: distinctId,
    properties: {
      version: VERSION,
      os: process.platform,
      arch: process.arch,
      $lib: "beheld-cli",
    },
    timestamp: new Date().toISOString(),
  };
}

export async function capture({ distinctId, event, apiKey, fetchImpl }: CaptureInput): Promise<void> {
  const key = apiKey ?? process.env.POSTHOG_CLI_KEY ?? DEFAULT_POSTHOG_CLI_KEY;
  if (!key) return;

  const payload = buildPayload(distinctId, event, key);
  const f = fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    await f(`${POSTHOG_HOST}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch {
    // fire-and-forget: never propagate
  } finally {
    clearTimeout(timer);
  }
}

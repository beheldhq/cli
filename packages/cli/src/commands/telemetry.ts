/**
 * `beheld telemetry` — status / enable / disable / show.
 *
 * `show` is the moat of confidence: it prints the literal payload that
 * would be sent to PostHog. No marketing, no abstraction. The user reads
 * exactly what leaves their machine.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { hashInstallId, installIdPath, readInstallId } from "../lib/install-id";
import { capture, buildPayload, type TelemetryPayload } from "../lib/telemetry-client";
import { telemetryDisabledReason } from "../lib/telemetry-config";
import type { BeheldConfig, TelemetryConfig } from "../types";

function beheldDir(): string {
  return process.env.BEHELD_DATA_DIR
    ? join(process.env.BEHELD_DATA_DIR, ".beheld")
    : join(homedir(), ".beheld");
}

function configPath(): string {
  return join(beheldDir(), "config.json");
}

function lastPingPath(): string {
  return join(beheldDir(), "telemetry-last-ping");
}

function readConfig(): BeheldConfig | null {
  if (!existsSync(configPath())) return null;
  try {
    return JSON.parse(readFileSync(configPath(), "utf8")) as BeheldConfig;
  } catch {
    return null;
  }
}

function writeConfig(config: BeheldConfig): void {
  mkdirSync(beheldDir(), { recursive: true, mode: 0o700 });
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n");
}

function updateTelemetry(config: BeheldConfig | null, telemetry: TelemetryConfig): BeheldConfig {
  if (config) return { ...config, telemetry };
  // Edge case: no config yet — the user hit `telemetry enable` before
  // `beheld init` ran. Persist a minimal stub so the choice survives.
  const stub: BeheldConfig = {
    version: "unknown",
    initialized_at: new Date().toISOString(),
    dimensions: {
      prompt_quality: false,
      test_maturity: false,
      tech_breadth: false,
      work_hours: false,
      project_type: false,
    },
    environments: { claudeCode: false, continueDev: false },
    telemetry,
  };
  return stub;
}

function readLastPingMs(): number | null {
  try {
    const raw = readFileSync(lastPingPath(), "utf8").trim();
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function formatAgo(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function statusLine(config: BeheldConfig | null): string {
  const reason = telemetryDisabledReason(config);
  if (reason === null) {
    const last = readLastPingMs();
    if (last == null) return "Status: enabled (no ping yet)";
    return `Status: enabled (last ping: ${formatAgo(Date.now() - last)})`;
  }
  switch (reason) {
    case "env-no-telemetry": return "Status: disabled (BEHELD_NO_TELEMETRY=1)";
    case "env-debug":        return "Status: disabled (BEHELD_DEBUG=1)";
    case "env-test":         return "Status: disabled (NODE_ENV=test)";
    case "consent-denied":   return "Status: disabled (opted out)";
    case "consent-unset":    return "Status: disabled (consent unset — run `beheld init`)";
  }
}

export async function telemetryStatusCommand(): Promise<void> {
  console.log(statusLine(readConfig()));
}

export async function telemetryEnableCommand(): Promise<void> {
  const config = readConfig();
  const previous = config?.telemetry?.consent;
  const next = updateTelemetry(config, {
    consent: "granted",
    consented_at: new Date().toISOString(),
  });
  writeConfig(next);
  console.log("Telemetry enabled. The CLI will send one anonymous ping per day.");

  // Mirror the init flow: when consent flips from non-granted to granted,
  // fire `cli_installed` once so the install shows up in PostHog. Same
  // distinct-id contract as cli_active_day (sha256 of install-id).
  if (previous !== "granted") {
    const id = await readInstallId();
    if (id) {
      void capture({ distinctId: hashInstallId(id), event: "cli_installed" });
    }
  }
}

export async function telemetryDisableCommand(): Promise<void> {
  const config = readConfig();
  const next = updateTelemetry(config, {
    consent: "denied",
    consented_at: new Date().toISOString(),
  });
  writeConfig(next);
  console.log("Telemetry disabled. No anonymous pings will be sent.");
}

export async function telemetryShowCommand(): Promise<void> {
  const id = await readInstallId();
  if (!id) {
    console.log("No install-id yet. Run `beheld bootstrap` first.");
    console.log("");
    console.log(statusLine(readConfig()));
    return;
  }
  const fakeKey = "phc_xxxx";
  const payload: TelemetryPayload = buildPayload(hashInstallId(id), "cli_active_day", fakeKey);
  // Show the payload sans api_key — the key is public-by-design but
  // surfaces nothing useful and adds noise.
  const display = {
    event: payload.event,
    distinct_id: payload.distinct_id,
    properties: payload.properties,
  };
  console.log("The CLI would send this payload once per day to https://eu.posthog.com/capture/");
  console.log(JSON.stringify(display, null, 2));
  console.log("");
  console.log(statusLine(readConfig()));
  console.log("Disable any time: BEHELD_NO_TELEMETRY=1");
}

// Helper exported for the active-day hook in src/index.ts.
export async function maybePingActiveDay(now: number = Date.now()): Promise<void> {
  const config = readConfig();
  if (telemetryDisabledReason(config) !== null) return;

  const id = await readInstallId();
  if (!id) return;

  const last = readLastPingMs();
  const DAY_MS = 24 * 60 * 60 * 1000;
  if (last != null && now - last < DAY_MS) return;

  try {
    mkdirSync(beheldDir(), { recursive: true, mode: 0o700 });
    writeFileSync(lastPingPath(), String(now), { mode: 0o600 });
  } catch {
    return; // can't record — skip rather than spam
  }

  void capture({ distinctId: hashInstallId(id), event: "cli_active_day" });
}

// Used by `beheld doctor` to print the same one-liner without spawning
// a subprocess.
export function telemetryStatusForDoctor(): string {
  return statusLine(readConfig());
}

// Suppress unused-import warnings for the type-only re-export users may
// follow from src/index.ts wiring.
export type { TelemetryPayload } from "../lib/telemetry-client";
export { installIdPath };

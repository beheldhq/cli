import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { isTelemetryDisabled, telemetryDisabledReason } from "../src/lib/telemetry-config";
import type { BeheldConfig } from "../src/types";

function configWithConsent(consent: "granted" | "denied" | "unset" | undefined): BeheldConfig {
  return {
    version: "0.5.0",
    initialized_at: "2026-06-11T00:00:00.000Z",
    dimensions: {
      prompt_quality: false,
      test_maturity: false,
      tech_breadth: false,
      work_hours: false,
      project_type: false,
    },
    environments: { claudeCode: false, continueDev: false },
    ...(consent ? { telemetry: { consent, consented_at: "2026-06-11T00:00:00.000Z" } } : {}),
  };
}

const SAVED_ENV: Record<string, string | undefined> = {};
const KEYS = ["BEHELD_NO_TELEMETRY", "BEHELD_DEBUG", "NODE_ENV"] as const;

beforeEach(() => {
  for (const k of KEYS) SAVED_ENV[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
});

describe("telemetryDisabledReason", () => {
  test("returns null when consent is granted and no override is set", () => {
    expect(telemetryDisabledReason(configWithConsent("granted"))).toBeNull();
    expect(isTelemetryDisabled(configWithConsent("granted"))).toBe(false);
  });

  test("env-no-telemetry beats granted consent", () => {
    process.env.BEHELD_NO_TELEMETRY = "1";
    expect(telemetryDisabledReason(configWithConsent("granted"))).toBe("env-no-telemetry");
  });

  test("BEHELD_DEBUG=1 disables telemetry", () => {
    process.env.BEHELD_DEBUG = "1";
    expect(telemetryDisabledReason(configWithConsent("granted"))).toBe("env-debug");
  });

  test("NODE_ENV=test disables telemetry", () => {
    process.env.NODE_ENV = "test";
    expect(telemetryDisabledReason(configWithConsent("granted"))).toBe("env-test");
  });

  test("explicit denial reads as consent-denied", () => {
    expect(telemetryDisabledReason(configWithConsent("denied"))).toBe("consent-denied");
  });

  test("missing consent reads as consent-unset", () => {
    expect(telemetryDisabledReason(configWithConsent(undefined))).toBe("consent-unset");
    expect(telemetryDisabledReason(configWithConsent("unset"))).toBe("consent-unset");
    expect(telemetryDisabledReason(null)).toBe("consent-unset");
  });
});

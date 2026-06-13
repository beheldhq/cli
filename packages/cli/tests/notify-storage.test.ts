/**
 * Module 2 — notify-commands. Tests for storage/notify.ts.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  clearNotifyState,
  readNotifyState,
  writeNotifyState,
} from "../src/storage/notify";

let workDir: string;
let configFile: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "beheld-notify-store-"));
  configFile = join(workDir, "config.json");
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("readNotifyState", () => {
  test("returns an empty object when config.json is missing", () => {
    expect(readNotifyState(configFile)).toEqual({});
  });

  test("returns only notify_* keys, ignoring unrelated config", () => {
    writeFileSync(configFile, JSON.stringify({
      version: "1.0.0",
      initialized_at: "2026-01-01",
      dimensions: {},
      environments: {},
      author_email: "unrelated@example.test",
      notification_email: { value: "a@b.test", verified: true, verified_at: null },
      notify_consents: { security: true, recovery: true, bundle_events: false, weekly: false },
    }));

    const state = readNotifyState(configFile);
    expect(state.notification_email).toEqual({
      value: "a@b.test",
      verified: true,
      verified_at: null,
    });
    expect(state.notify_consents?.security).toBe(true);
    expect("author_email" in state).toBe(false);
  });
});

describe("writeNotifyState", () => {
  test("creates config.json with defaults when missing and writes notify_* keys", () => {
    writeNotifyState(
      { notify_consents: { security: true, recovery: true, bundle_events: false, weekly: true } },
      configFile,
    );
    const raw = JSON.parse(readFileSync(configFile, "utf8"));
    expect(raw.notify_consents.weekly).toBe(true);
    expect(raw.version).toBe("0.0.0"); // default
  });

  test("preserves unrelated keys on merge", () => {
    writeFileSync(configFile, JSON.stringify({
      version: "1.0.0",
      initialized_at: "2026-01-01",
      dimensions: { prompt_quality: true },
      environments: { claudeCode: true, continueDev: false },
      author_email: "keep@example.test",
      bitbucket_username: "keepme",
      email_recovery: "legacy@example.test",
    }));
    writeNotifyState(
      { notification_email: { value: "new@example.test", verified: false, verified_at: null } },
      configFile,
    );
    const raw = JSON.parse(readFileSync(configFile, "utf8"));
    expect(raw.author_email).toBe("keep@example.test");
    expect(raw.bitbucket_username).toBe("keepme");
    expect(raw.email_recovery).toBe("legacy@example.test");
    expect(raw.dimensions.prompt_quality).toBe(true);
    expect(raw.notification_email.value).toBe("new@example.test");
  });

  test("undefined removes the field", () => {
    writeFileSync(configFile, JSON.stringify({
      version: "1.0.0",
      initialized_at: "2026-01-01",
      dimensions: {},
      environments: {},
      notification_email: { value: "old@example.test", verified: true, verified_at: null },
    }));
    writeNotifyState({ notification_email: undefined }, configFile);
    const raw = JSON.parse(readFileSync(configFile, "utf8"));
    expect("notification_email" in raw).toBe(false);
  });
});

describe("clearNotifyState", () => {
  test("scope=notification only removes notification_email", () => {
    writeNotifyState(
      {
        notification_email: { value: "n@example.test", verified: true, verified_at: null },
        recovery_email: { value: "r@example.test", verified: true, verified_at: null },
        notify_consents: { security: true, recovery: true, bundle_events: false, weekly: false },
      },
      configFile,
    );
    clearNotifyState("notification", configFile);
    const state = readNotifyState(configFile);
    expect(state.notification_email).toBeUndefined();
    expect(state.recovery_email).toBeDefined();
    expect(state.notify_consents).toBeDefined();
  });

  test("scope=all wipes every notify_* key", () => {
    writeNotifyState(
      {
        notification_email: { value: "n@example.test", verified: true, verified_at: null },
        recovery_email: { value: "r@example.test", verified: true, verified_at: null },
        notify_consents: { security: true, recovery: true, bundle_events: false, weekly: false },
        notify_secondary_offer_shown: true,
      },
      configFile,
    );
    clearNotifyState("all", configFile);
    expect(readNotifyState(configFile)).toEqual({});
  });

  test("never touches the legacy email_recovery string", () => {
    writeFileSync(configFile, JSON.stringify({
      version: "1.0.0",
      initialized_at: "2026-01-01",
      dimensions: {},
      environments: {},
      email_recovery: "legacy@example.test",
      notification_email: { value: "new@example.test", verified: false, verified_at: null },
    }));
    clearNotifyState("all", configFile);
    const raw = JSON.parse(readFileSync(configFile, "utf8"));
    expect(raw.email_recovery).toBe("legacy@example.test");
    expect("notification_email" in raw).toBe(false);
  });
});

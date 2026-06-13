/**
 * Module 2A — bearer-token-persistence.
 * Tests for ~/.beheld/session.json reader/writer/clear and mode 0600.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SESSION_SCHEMA_VERSION,
  clearSession,
  isSessionExpired,
  readSession,
  sessionFileMode,
  sessionPath,
  writeSession,
  type PersistedSession,
} from "../src/storage/session";

let workDir: string;

function makeSession(overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    schema_version: SESSION_SCHEMA_VERSION,
    token: "a".repeat(64),
    fingerprint: "b".repeat(64),
    api_base: "https://beheld.test",
    created_at: new Date("2026-06-12T10:00:00Z").toISOString(),
    expires_at: new Date("2026-06-13T10:00:00Z").toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "beheld-session-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("writeSession", () => {
  test("creates the directory if missing and persists JSON", () => {
    const beheldDir = join(workDir, "data", ".beheld");
    writeSession(makeSession(), beheldDir);
    expect(existsSync(sessionPath(beheldDir))).toBe(true);
  });

  test("file is mode 0600", () => {
    const beheldDir = join(workDir, ".beheld");
    writeSession(makeSession(), beheldDir);
    expect(sessionFileMode(beheldDir)).toBe(0o600);
  });

  test("overwrites a previous session", () => {
    const beheldDir = join(workDir, ".beheld");
    writeSession(makeSession({ token: "old".padEnd(64, "x") }), beheldDir);
    writeSession(makeSession({ token: "new".padEnd(64, "y") }), beheldDir);
    const loaded = readSession(beheldDir);
    expect(loaded?.token.startsWith("new")).toBe(true);
  });
});

describe("readSession", () => {
  test("returns null when the file is missing", () => {
    expect(readSession(join(workDir, ".beheld"))).toBeNull();
  });

  test("round-trips a valid session", () => {
    const beheldDir = join(workDir, ".beheld");
    const original = makeSession();
    writeSession(original, beheldDir);
    expect(readSession(beheldDir)).toEqual(original);
  });

  test("returns null when the file is unparseable", () => {
    const beheldDir = join(workDir, ".beheld");
    writeSession(makeSession(), beheldDir);
    writeFileSync(sessionPath(beheldDir), "{not json");
    expect(readSession(beheldDir)).toBeNull();
  });

  test("returns null when schema_version mismatches", () => {
    const beheldDir = join(workDir, ".beheld");
    mkdirSync(beheldDir, { recursive: true });
    writeFileSync(
      sessionPath(beheldDir),
      JSON.stringify({ ...makeSession(), schema_version: 99 }),
    );
    expect(readSession(beheldDir)).toBeNull();
  });

  test("returns null when required fields are missing", () => {
    const beheldDir = join(workDir, ".beheld");
    mkdirSync(beheldDir, { recursive: true });
    writeFileSync(sessionPath(beheldDir), JSON.stringify({
      schema_version: SESSION_SCHEMA_VERSION,
      // token intentionally omitted
      fingerprint: "x",
      api_base: "y",
      created_at: "z",
      expires_at: "w",
    }));
    expect(readSession(beheldDir)).toBeNull();
  });
});

describe("clearSession", () => {
  test("removes the file", () => {
    const beheldDir = join(workDir, ".beheld");
    writeSession(makeSession(), beheldDir);
    clearSession(beheldDir);
    expect(existsSync(sessionPath(beheldDir))).toBe(false);
  });

  test("is idempotent when the file is already missing", () => {
    const beheldDir = join(workDir, ".beheld");
    expect(() => clearSession(beheldDir)).not.toThrow();
  });
});

describe("isSessionExpired", () => {
  test("is true when session is null", () => {
    expect(isSessionExpired(null)).toBe(true);
  });

  test("is true when expires_at is in the past", () => {
    const past = makeSession({ expires_at: new Date("2020-01-01").toISOString() });
    expect(isSessionExpired(past, new Date("2026-06-12"))).toBe(true);
  });

  test("is false when expires_at is in the future", () => {
    const future = makeSession({ expires_at: new Date("2099-01-01").toISOString() });
    expect(isSessionExpired(future, new Date("2026-06-12"))).toBe(false);
  });

  test("is true when expires_at is unparseable", () => {
    const broken = makeSession({ expires_at: "not-a-date" });
    expect(isSessionExpired(broken)).toBe(true);
  });
});

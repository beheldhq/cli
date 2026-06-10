import { describe, expect, test } from "bun:test";
import {
  EMBEDDED_KEYS_SOURCE,
  EMBEDDED_PLATFORM_KEYS,
  activePlatformKeys,
  findPlatformKey,
} from "../src/keys/platform-keys";

describe("embedded platform keys", () => {
  test("at least one key is embedded", () => {
    expect(EMBEDDED_PLATFORM_KEYS.length).toBeGreaterThan(0);
  });

  test("every key has the required fields with correct types", () => {
    for (const key of EMBEDDED_PLATFORM_KEYS) {
      expect(key.key_id).toMatch(/^beheld-platform-\d{4}-q[1-4]$/);
      expect(key.algorithm).toBe("ed25519");
      expect(key.public_key).toMatch(/^ed25519-pub:[A-Za-z0-9+/=]+$/);
      expect(typeof key.active).toBe("boolean");
      expect(typeof key.revoked).toBe("boolean");
      expect(typeof key.created_at).toBe("string");
    }
  });

  test("source points to the canonical path in the web repo", () => {
    expect(EMBEDDED_KEYS_SOURCE).toBe("web/source/backend/keys/platform");
  });

  test("findPlatformKey returns the matching key", () => {
    const first = EMBEDDED_PLATFORM_KEYS[0]!;
    expect(findPlatformKey(first.key_id)).toEqual(first);
  });

  test("findPlatformKey returns undefined for unknown id", () => {
    expect(findPlatformKey("beheld-platform-9999-q9")).toBeUndefined();
  });

  test("activePlatformKeys filters out inactive and revoked", () => {
    for (const k of activePlatformKeys()) {
      expect(k.active).toBe(true);
      expect(k.revoked).toBe(false);
    }
  });

  test("at least one active key is present (sanity)", () => {
    expect(activePlatformKeys().length).toBeGreaterThanOrEqual(1);
  });
});

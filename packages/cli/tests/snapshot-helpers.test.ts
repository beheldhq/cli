import { describe, expect, test } from "bun:test";

import { __test } from "../src/commands/snapshot";
import type { RekorEntry } from "../src/bundle/types";
import type { RekorSubmitResult, RekorFailureReason } from "../src/lib/rekor";

const { toHex, stripPrefix, jwkXToHex, rekorFailureLabel, renderRekorLine, bundleFilename } = __test;

const plain = (s: string): string => s.replace(/\[[0-9;]*m/g, "");

// ── toHex ────────────────────────────────────────────────────────────────────

describe("toHex", () => {
  test("encodes bytes as zero-padded lowercase hex", () => {
    expect(toHex(new Uint8Array([0, 15, 255, 16]).buffer)).toBe("000fff10");
  });

  test("empty buffer → empty string", () => {
    expect(toHex(new Uint8Array([]).buffer)).toBe("");
  });
});

// ── stripPrefix ──────────────────────────────────────────────────────────────

describe("stripPrefix", () => {
  test("removes a matching prefix", () => {
    expect(stripPrefix("sha256:abcd", "sha256:")).toBe("abcd");
    expect(stripPrefix("ed25519:ff00", "ed25519:")).toBe("ff00");
  });

  test("returns the value unchanged when the prefix is absent", () => {
    expect(stripPrefix("abcd", "sha256:")).toBe("abcd");
  });
});

// ── jwkXToHex ────────────────────────────────────────────────────────────────

describe("jwkXToHex", () => {
  test("decodes a base64url JWK x to raw hex", () => {
    // "AQIDBA" (base64url, unpadded) → bytes [1,2,3,4] → "01020304"
    expect(jwkXToHex("AQIDBA")).toBe("01020304");
  });

  test("handles base64url-specific chars (- and _)", () => {
    // bytes [0xfb, 0xff] encode to "-_8" — round-trips back to "fbff"
    expect(jwkXToHex(Buffer.from("fbff", "hex").toString("base64url"))).toBe("fbff");
  });
});

// ── rekorFailureLabel ────────────────────────────────────────────────────────

describe("rekorFailureLabel", () => {
  const cases: [RekorFailureReason, string][] = [
    ["timeout", "timed out (boom)"],
    ["network", "network unavailable (boom)"],
    ["rejected", "Rekor refused: boom"],
    ["encoding", "local encoding error: boom"],
    ["malformed", "invalid Rekor response: boom"],
  ];
  for (const [reason, expected] of cases) {
    test(`${reason} → "${expected}"`, () => {
      expect(rekorFailureLabel(reason, "boom")).toBe(expected);
    });
  }

  test("unknown reason falls back to a generic label", () => {
    expect(rekorFailureLabel("weird" as RekorFailureReason, "boom")).toBe("unknown failure (boom)");
  });
});

// ── renderRekorLine ──────────────────────────────────────────────────────────

describe("renderRekorLine", () => {
  test("null → opt-out message (distinct from a failure)", () => {
    const line = plain(renderRekorLine(null));
    expect(line).toContain("skipped by --no-rekor");
    expect(line).not.toContain("not recorded");
  });

  test("success → log index and integrated time", () => {
    const entry: RekorEntry = {
      logIndex: 42,
      uuid: "u",
      integratedTime: "2026-05-14T03:42:00.000Z",
      signedEntryTimestamp: "set==",
    };
    const line = plain(renderRekorLine({ ok: true, entry }));
    expect(line).toContain("log #42");
    expect(line).toContain("2026-05-14T03:42:00.000Z");
  });

  test("failure → 'not recorded' with the reason label and resubmit hint", () => {
    const result: RekorSubmitResult = { ok: false, reason: "timeout", detail: "8s" };
    const line = plain(renderRekorLine(result));
    expect(line).toContain("not recorded");
    expect(line).toContain("timed out (8s)");
    expect(line).toContain("--rekor-submit");
  });
});

// ── bundleFilename ───────────────────────────────────────────────────────────

describe("bundleFilename", () => {
  test("builds <yyyymmdd>_<hash8>.beheld from ISO date + sha256 hash", () => {
    expect(bundleFilename("2026-05-14T03:42:00+00:00", `sha256:abcdef0123456789${"0".repeat(48)}`))
      .toBe("20260514_abcdef01.beheld");
  });
});

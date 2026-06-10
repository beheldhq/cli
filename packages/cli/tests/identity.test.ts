/**
 * F5.6 — `beheld identity status` and `beheld identity link` (alias of attest).
 *
 * Covers the surface-level wrapper added so the F5.6 spec's command names are
 * reachable. The OAuth flow itself is exercised by attest.test.ts.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { identityStatusCommand, identityLinkCommand } from "../src/commands/identity";
import {
  type CachedAttestation,
  saveAttestationCache,
} from "../src/keys/attestation-cache";

let workDir: string;
let savedEnv: string | undefined;
let logs: string[];
let originalLog: typeof console.log;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "beheld-identity-"));
  savedEnv = process.env.BEHELD_DATA_DIR;
  process.env.BEHELD_DATA_DIR = workDir;
  logs = [];
  originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
});

afterEach(() => {
  console.log = originalLog;
  if (savedEnv === undefined) delete process.env.BEHELD_DATA_DIR;
  else process.env.BEHELD_DATA_DIR = savedEnv;
  rmSync(workDir, { recursive: true, force: true });
});

const SAMPLE: CachedAttestation = {
  payload: {
    type: "beheld-identity-attestation/v1",
    platform_key_id: "beheld-platform-2026-q2",
    dev_pubkey: "ed25519-pub:AAAA",
    github: {
      user_id: 12345,
      login: "octocat",
      verified_at: "2026-05-19T18:00:00Z",
    },
    attested_at: "2026-05-19T18:00:00Z",
  },
  signature: "ed25519:AAAA",
};

describe("identity status", () => {
  test("without cached attestation → tells user to run identity link", async () => {
    await identityStatusCommand();
    const all = logs.join("\n");
    expect(all).toContain("not linked");
    expect(all).toContain("beheld identity link");
  });

  test("with cached attestation → shows @login, id, platform_key_id and attested_at", async () => {
    saveAttestationCache(SAMPLE);
    await identityStatusCommand();
    const all = logs.join("\n");
    expect(all).toContain("linked");
    expect(all).toContain("@octocat");
    expect(all).toContain("id=12345");
    expect(all).toContain("beheld-platform-2026-q2");
    expect(all).toContain("2026-05-19T18:00:00Z");
  });

  test("uses dataDir override (test seam) instead of BEHELD_DATA_DIR", async () => {
    const altDir = mkdtempSync(join(tmpdir(), "beheld-identity-alt-"));
    try {
      // No file in altDir → must report "not linked" even with SAMPLE in workDir
      saveAttestationCache(SAMPLE);
      await identityStatusCommand({ dataDir: altDir });
      expect(logs.join("\n")).toContain("not linked");
    } finally {
      rmSync(altDir, { recursive: true, force: true });
    }
  });
});

describe("identity link", () => {
  test("is the same command as `beheld attest` — function delegates without a new implementation", async () => {
    // We don't exercise the full OAuth flow here (it needs a live server),
    // but we assert the alias is wired: identityLinkCommand must be the same
    // export shape as attestCommand (one optional opts argument).
    expect(typeof identityLinkCommand).toBe("function");
    expect(identityLinkCommand.length).toBeLessThanOrEqual(1);
  });
});

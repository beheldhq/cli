import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hashInstallId, installIdPath, readInstallId } from "../src/lib/install-id";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "beheld-installid-"));
  mkdirSync(join(dataDir, ".beheld"), { recursive: true });
  process.env.BEHELD_DATA_DIR = dataDir;
});

afterEach(() => {
  delete process.env.BEHELD_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("readInstallId", () => {
  test("returns null when the file is missing", async () => {
    expect(await readInstallId()).toBeNull();
  });

  test("returns the trimmed contents when the file exists", async () => {
    writeFileSync(installIdPath(), "  3f2504e0-4f89-11d3-9a0c-0305e82c3301\n  ");
    expect(await readInstallId()).toBe("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
  });

  test("returns null when the file is empty", async () => {
    writeFileSync(installIdPath(), "");
    expect(await readInstallId()).toBeNull();
  });
});

describe("hashInstallId", () => {
  test("produces a stable sha256 hex digest", () => {
    expect(hashInstallId("3f2504e0-4f89-11d3-9a0c-0305e82c3301"))
      .toBe("d1bfaf4aff653cb27984b7d978e51a7d406d1572df95d205c254beb18dc134d3");
  });

  test("two distinct ids produce different hashes", () => {
    expect(hashInstallId("a")).not.toBe(hashInstallId("b"));
  });
});

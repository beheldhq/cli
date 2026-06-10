/**
 * Tests for the P22 bundle-age nudge. We point BEHELD_HOME at a temp dir
 * so the tests never touch the user's real ~/.beheld.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync, utimesSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Force-show flag bypasses the TTY check the module uses to keep tests
// behaving consistently inside the bun test runner (which is not a TTY).
function setHomeFixture(): string {
  const home = path.join(os.tmpdir(), `beheld-nudge-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.BEHELD_HOME = home;
  process.env.BEHELD_FORCE_NUDGE = "1";
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  return home;
}

function writeSnapshotWithAge(home: string, name: string, daysOld: number): void {
  const dir = path.join(home, "snapshots");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, "{}");
  const past = new Date(Date.now() - daysOld * 86_400_000);
  utimesSync(file, past, past);
}

function captureStderr(fn: () => void): string {
  const original = process.stderr.write.bind(process.stderr);
  let captured = "";
  (process.stderr.write as unknown as (chunk: string) => boolean) = (chunk: string) => {
    captured += chunk;
    return true;
  };
  try { fn(); } finally {
    process.stderr.write = original as typeof process.stderr.write;
  }
  return captured;
}

describe("maybeShowBundleNudge", () => {
  let home = "";

  beforeEach(() => {
    home = setHomeFixture();
    // Drop bun's module cache for our fresh BEHELD_HOME on each run.
    delete require.cache?.[require.resolve("../src/lib/nudge")];
  });

  afterEach(() => {
    if (existsSync(home)) rmSync(home, { recursive: true, force: true });
    delete process.env.BEHELD_HOME;
    delete process.env.BEHELD_FORCE_NUDGE;
  });

  it("does not print nudge when there are no snapshots", async () => {
    const { maybeShowBundleNudge } = await import("../src/lib/nudge");
    const out = captureStderr(() => maybeShowBundleNudge());
    expect(out).toBe("");
  });

  it("does not print nudge when the latest bundle is < 5 days old", async () => {
    writeSnapshotWithAge(home, "recent.beheld", 2);
    const { maybeShowBundleNudge } = await import("../src/lib/nudge");
    const out = captureStderr(() => maybeShowBundleNudge());
    expect(out).toBe("");
  });

  it("prints nudge when the bundle is ≥ 5 days old", async () => {
    writeSnapshotWithAge(home, "old.beheld", 7);
    const { maybeShowBundleNudge } = await import("../src/lib/nudge");
    const out = captureStderr(() => maybeShowBundleNudge());
    expect(out).toMatch(/Your bundle is 7 days old/);
    expect(out).toMatch(/beheld snapshot/);
  });

  it("picks the newest snapshot among several (age of the most recent)", async () => {
    writeSnapshotWithAge(home, "ancient.beheld", 30);
    writeSnapshotWithAge(home, "newer.beheld", 3);
    const { maybeShowBundleNudge } = await import("../src/lib/nudge");
    const out = captureStderr(() => maybeShowBundleNudge());
    // The newest is 3 days old → no nudge
    expect(out).toBe("");
  });

  it("suppresses the second call within the same session (ppid marker)", async () => {
    writeSnapshotWithAge(home, "old.beheld", 10);
    const { maybeShowBundleNudge } = await import("../src/lib/nudge");

    const first  = captureStderr(() => maybeShowBundleNudge());
    const second = captureStderr(() => maybeShowBundleNudge());

    expect(first).toMatch(/Your bundle is/);
    expect(second).toBe("");
    expect(existsSync(path.join(home, ".nudge_session"))).toBe(true);
    const marker = readFileSync(path.join(home, ".nudge_session"), "utf-8");
    expect(marker).toMatch(new RegExp(`^${process.ppid}:\\d+$`));
  });

  it("accepts .dpbundle in addition to .beheld", async () => {
    writeSnapshotWithAge(home, "old.dpbundle", 8);
    const { maybeShowBundleNudge } = await import("../src/lib/nudge");
    const out = captureStderr(() => maybeShowBundleNudge());
    expect(out).toMatch(/Your bundle is 8 days old/);
  });
});

import { describe, expect, test } from "bun:test";

import { __test } from "../src/commands/harness";
import type {
  CaptureFidelity,
  HarnessAdapter,
  InstallResult,
  InstallAllResult,
} from "../src/lib/harness-installer";

const { FIDELITY_BLURB, explanationFor, fidelityTag, rowFor, installResultLines } = __test;

// strip ANSI colour so assertions match plain text
const plain = (s: string): string => s.replace(/\[[0-9;]*m/g, "");

function adapter(over: Partial<HarnessAdapter> = {}): HarnessAdapter {
  return {
    name: "claude-code",
    label: "Claude Code",
    fidelity: "native_hook",
    description: "writes a SessionEnd hook",
    isInstalled: () => true,
    install: () => ({ changed: false, wroteFile: false, requiresManualSetup: false }),
    uninstall: () => ({ changed: false }),
    ...over,
  };
}

function result(over: Partial<InstallAllResult> = {}): InstallAllResult {
  return { adapter: adapter(), detected: true, installed: null, ...over };
}

function installed(over: Partial<InstallResult> = {}): InstallResult {
  return { changed: true, wroteFile: true, requiresManualSetup: false, ...over };
}

// ── fidelityTag ──────────────────────────────────────────────────────────────

describe("fidelityTag", () => {
  const cases: [CaptureFidelity, string][] = [
    ["native_hook", "high"],
    ["editor_extension", "high"],
    ["local_log_tail", "med"],
    ["statusline", "med"],
    ["inferred", "low"],
  ];
  for (const [fidelity, tier] of cases) {
    test(`${fidelity} → ${tier} tier`, () => {
      expect(fidelityTag(adapter({ fidelity }))).toBe(`${fidelity} (${tier})`);
    });
  }
});

// ── FIDELITY_BLURB ───────────────────────────────────────────────────────────

describe("FIDELITY_BLURB", () => {
  test("has a blurb for every CaptureFidelity value", () => {
    const keys: CaptureFidelity[] = [
      "native_hook", "editor_extension", "local_log_tail", "statusline", "inferred",
    ];
    for (const k of keys) {
      expect(FIDELITY_BLURB[k]).toBeTruthy();
    }
  });
});

// ── explanationFor ───────────────────────────────────────────────────────────

describe("explanationFor", () => {
  test("joins the generic blurb with the adapter-specific description", () => {
    const line = plain(explanationFor(adapter({ fidelity: "native_hook", description: "hook XYZ" })));
    expect(line).toContain(FIDELITY_BLURB.native_hook);
    expect(line).toContain(" · hook XYZ");
  });

  test("omits the separator when the adapter has no description", () => {
    const line = plain(explanationFor(adapter({ fidelity: "inferred", description: "  " })));
    expect(line).toContain(FIDELITY_BLURB.inferred);
    expect(line).not.toContain(" · ");
  });
});

// ── rowFor ───────────────────────────────────────────────────────────────────

describe("rowFor", () => {
  test("shows '✓ detected' when installed and '—' tail for non-tail fidelity", () => {
    const row = plain(rowFor(adapter({ fidelity: "native_hook", isInstalled: () => true }), new Set()));
    expect(row).toContain("✓ detected");
    expect(row).toContain("—");
  });

  test("shows 'not detected' when the adapter is absent", () => {
    const row = plain(rowFor(adapter({ isInstalled: () => false }), new Set()));
    expect(row).toContain("not detected");
  });

  test("tail adapter reflects ON when present in the enabled set", () => {
    const a = adapter({ name: "cursor", fidelity: "local_log_tail" });
    expect(plain(rowFor(a, new Set(["cursor"])))).toContain("tail: ON");
  });

  test("tail adapter reflects off when absent from the enabled set", () => {
    const a = adapter({ name: "cursor", fidelity: "statusline" });
    expect(plain(rowFor(a, new Set()))).toContain("tail: off");
  });
});

// ── installResultLines ───────────────────────────────────────────────────────

describe("installResultLines", () => {
  test("not detected → single skip line mentioning --force", () => {
    const lines = installResultLines(result({ detected: false }));
    expect(lines).toHaveLength(1);
    expect(plain(lines[0]!)).toContain("not detected");
    expect(plain(lines[0]!)).toContain("--force");
  });

  test("detected but no install action → 'no install action'", () => {
    const lines = installResultLines(result({ detected: true, installed: null }));
    expect(plain(lines[0]!)).toContain("no install action");
  });

  test("manual setup with a note → two lines (header + indented note)", () => {
    const lines = installResultLines(result({
      installed: installed({ requiresManualSetup: true, note: "line1\nline2" }),
    }));
    expect(lines).toHaveLength(2);
    expect(plain(lines[0]!)).toContain("manual setup required");
    expect(plain(lines[1]!)).toContain("line1");
    expect(plain(lines[1]!)).toContain("    line2"); // continuation indented
  });

  test("manual setup without a note → single header line", () => {
    const lines = installResultLines(result({
      installed: installed({ requiresManualSetup: true }),
    }));
    expect(lines).toHaveLength(1);
  });

  test("changed → '✓' line with the note", () => {
    const lines = installResultLines(result({ installed: installed({ changed: true, note: "wrote hook" }) }));
    expect(plain(lines[0]!)).toContain("✓");
    expect(plain(lines[0]!)).toContain("wrote hook");
  });

  test("changed without note → defaults to 'installed'", () => {
    const lines = installResultLines(result({ installed: installed({ changed: true }) }));
    expect(plain(lines[0]!)).toContain("installed");
  });

  test("unchanged → '·' line defaulting to 'already installed'", () => {
    const lines = installResultLines(result({ installed: installed({ changed: false }) }));
    expect(plain(lines[0]!)).toContain("already installed");
  });
});

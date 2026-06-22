import { describe, expect, test } from "bun:test";

import {
  GREEN_TRUECOLOR,
  GREEN_256,
  RESET,
  detectBrandEnv,
  type BrandEnv,
} from "./colors";
import { mark, lockup, lockupMid, banner, CURSOR } from "./mark";

const TAGLINE = "prova contínua de prática técnica";

// Deterministic environments — never read the real process.stdout/env.
const truecolor: BrandEnv = { tty: true, color: true, truecolor: true, width: 80 };
const ansi256: BrandEnv = { tty: true, color: true, truecolor: false, width: 80 };
const plain: BrandEnv = { tty: false, color: false, truecolor: false, width: 80 };
const narrow: BrandEnv = { tty: true, color: true, truecolor: true, width: 40 };

describe("detectBrandEnv", () => {
  test("NO_COLOR disables color even on a TTY", () => {
    const env = detectBrandEnv({ isTTY: true, columns: 100 }, { NO_COLOR: "1" });
    expect(env.color).toBe(false);
    expect(env.width).toBe(100);
  });

  test("empty NO_COLOR does not disable color", () => {
    const env = detectBrandEnv({ isTTY: true }, { NO_COLOR: "" });
    expect(env.color).toBe(true);
  });

  test("non-TTY (pipe/redirect) disables color", () => {
    const env = detectBrandEnv({ isTTY: false }, { COLORTERM: "truecolor" });
    expect(env.color).toBe(false);
  });

  test("$COLORTERM presence selects truecolor", () => {
    expect(detectBrandEnv({ isTTY: true }, { COLORTERM: "truecolor" }).truecolor).toBe(true);
    expect(detectBrandEnv({ isTTY: true }, {}).truecolor).toBe(false);
  });

  test("width falls back to 80 when columns is unknown", () => {
    expect(detectBrandEnv({ isTTY: true }, {}).width).toBe(80);
  });
});

describe("mark / lockup — color on", () => {
  test("truecolor wraps only the cursor in green", () => {
    expect(mark(truecolor)).toBe(`[${GREEN_TRUECOLOR}${CURSOR}${RESET}]`);
    expect(lockup(truecolor)).toBe(`[${GREEN_TRUECOLOR}${CURSOR}${RESET}] beheld`);
    expect(lockupMid(truecolor)).toBe(`b[${GREEN_TRUECOLOR}${CURSOR}${RESET}]held`);
  });

  test("256-color fallback when truecolor is unavailable", () => {
    expect(mark(ansi256)).toBe(`[${GREEN_256}${CURSOR}${RESET}]`);
  });
});

describe("mark / lockup — color off", () => {
  test("no ANSI escapes at all", () => {
    expect(mark(plain)).toBe(`[${CURSOR}]`);
    expect(lockup(plain)).toBe(`[${CURSOR}] beheld`);
    expect(lockupMid(plain)).toBe(`b[${CURSOR}]held`);
    expect(mark(plain)).not.toContain("\x1b");
  });
});

describe("banner", () => {
  test("renders the 3-line box on a wide terminal", () => {
    const out = banner(truecolor);
    const lines = out.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => [...l].length <= 60 || l.includes("\x1b"))).toBe(true);
    expect(out).toContain("beheld");
    expect(out).toContain(TAGLINE);
    expect(out).toContain(GREEN_TRUECOLOR);
  });

  test("plain banner carries no escapes and stays within 60 columns", () => {
    const out = banner(plain);
    for (const line of out.split("\n")) {
      expect(line).not.toContain("\x1b");
      expect([...line].length).toBeLessThanOrEqual(60);
    }
  });

  test("falls back to the inline lockup under 60 columns", () => {
    expect(banner(narrow)).toBe(lockup(narrow));
    expect(banner(narrow)).not.toContain("┌");
  });

  test("contains no emoji — only block, box-drawing, and Latin glyphs", () => {
    // No codepoint should fall in the emoji / pictograph / dingbat planes.
    const offenders = [...banner(truecolor)].filter((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      return (
        cp >= 0x1f000 || // emoji & pictographs (astral)
        (cp >= 0x2600 && cp <= 0x27bf) || // misc symbols + dingbats
        (cp >= 0xfe00 && cp <= 0xfe0f) // variation selectors
      );
    });
    expect(offenders).toEqual([]);
  });
});

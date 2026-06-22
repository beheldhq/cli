// The beheld mark for the terminal — the surface a CLI actually lives in.
//
// Geometry: a "#" cursor between two brackets. The cursor is the only thing
// ever painted green; the brackets and wordmark ride the terminal's default
// ink (spec §1, §2).
//
//   inline:        [#] beheld
//   cursor middle: b[#]held
//   banner:        a 3-line box, falling back to the inline lockup under 60 cols.

import { detectBrandEnv, greenSeq, resetSeq, dimSeq, type BrandEnv } from "./colors";

/**
 * Cursor glyph. `#` — ASCII, renders identically across every terminal/font
 * (a deliberate departure from the spec's Unicode block; brand decision).
 */
export const CURSOR = "#";

const TAGLINE = "prova contínua de prática técnica";

/** Wrap the cursor glyph in its green sequence for this environment. */
function paintedCursor(env: BrandEnv): string {
  return `${greenSeq(env)}${CURSOR}${resetSeq(env)}`;
}

/** Just the glyph: `[#]` with a green cursor. */
export function mark(env: BrandEnv = detectBrandEnv()): string {
  return `[${paintedCursor(env)}]`;
}

/** Short inline lockup: `[#] beheld`. */
export function lockup(env: BrandEnv = detectBrandEnv()): string {
  return `${mark(env)} beheld`;
}

/** Wordmark with the cursor nested mid-word: `b[#]held`. */
export function lockupMid(env: BrandEnv = detectBrandEnv()): string {
  return `b[${paintedCursor(env)}]held`;
}

/**
 * Multi-line banner for `beheld init`, `--version`, and the fatal-error splash
 * (spec §2.4). Stacked brackets in box-drawing with the green cursor centered
 * and a dim tagline. Stays ≤ 3 lines and ≤ 60 columns.
 *
 * When the terminal is narrower than 60 columns there is no room for the box —
 * we degrade to the inline lockup rather than wrap mid-glyph.
 */
export function banner(env: BrandEnv = detectBrandEnv()): string {
  if (env.width < 60) return lockup(env);
  const cursor = paintedCursor(env);
  const tag = `${dimSeq(env)}${TAGLINE}${resetSeq(env)}`;
  return [
    "  ┌       ┐",
    `  │   ${cursor}   │   beheld`,
    `  └       ┘   ${tag}`,
  ].join("\n");
}

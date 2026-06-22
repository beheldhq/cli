// Generates `beheld-lockup.svg` — the horizontal lockup (mark + wordmark).
//
// The wordmark is baked into vector OUTLINES from JetBrains Mono so the SVG has
// no webfont dependency (spec §3.3). Re-run only when the wordmark or its
// geometry changes:
//
//   bun add -d opentype.js          # one-off: not a runtime dependency
//   bun assets/brand/build-lockup.ts
//
// opentype.js is intentionally NOT a project dependency — the generated SVG is
// self-contained outlines, so the converter is only needed when regenerating.
// The font (OFL, redistributable) is fetched into the OS temp dir on first run;
// set BEHELD_FONT to use a local copy and skip the download.
//
// Glyph geometry mirrors the mark (spec §3.1, adapted): viewBox 0 0 _ 120,
// brackets at stroke-width 7, cursor drawn as a "#" in signal green. The
// wordmark sits to the right, ascenders aligned to the bracket top, baseline to
// the bracket bottom.

import opentype from "opentype.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const FONT_URL =
  "https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/ttf/JetBrainsMono-Regular.ttf";

// ── brand tokens (spec §1) ────────────────────────────────────────────────
const SIGNAL_GREEN = "#58d36c"; // cursor — always the active element
const INK = "#0a0b0b"; // tinta inversa — brackets + letters on a light bg
const B_GREEN = "#1f9a37"; // verde escuro — the "b" highlight on a light bg

// ── layout ──────────────────────────────────────────────────────────────
const FONT_SIZE = 100; // sampling size; the path is scaled to fit afterwards
const BASELINE_Y = 92; // matches bracket bottom
const ASC_TOP_Y = 28; // matches bracket top
const WORDMARK_LEFT = 120; // visual left edge of the wordmark
const PAD_RIGHT = 12;

async function loadFont(): Promise<ArrayBuffer> {
  const local = process.env.BEHELD_FONT;
  const cache = join(tmpdir(), "beheld-JetBrainsMono-Regular.ttf");
  const path = local ?? cache;
  if (!existsSync(path)) {
    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error(`font fetch failed: ${res.status}`);
    writeFileSync(cache, Buffer.from(await res.arrayBuffer()));
    return loadFont();
  }
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function build(font: opentype.Font): string {
  // Full string drives the scale/placement; per-glyph paths drive the color
  // split (the "b" is highlighted, the rest is ink).
  const whole = font.getPath("beheld", 0, 0, FONT_SIZE);
  const bb = whole.getBoundingBox();
  const ascHeight = -bb.y1; // pixels above baseline at FONT_SIZE
  const scale = (BASELINE_Y - ASC_TOP_Y) / ascHeight;
  const startX = WORDMARK_LEFT - bb.x1 * scale;

  const advB = font.getAdvanceWidth("b", FONT_SIZE);
  const dB = font.getPath("b", 0, 0, FONT_SIZE).toPathData(2);
  const dRest = font.getPath("eheld", advB, 0, FONT_SIZE).toPathData(2);

  const width = Math.ceil(startX + bb.x2 * scale + PAD_RIGHT);
  const wordTransform = `translate(${startX.toFixed(2)} ${BASELINE_Y}) scale(${scale.toFixed(4)})`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 120" width="${width}" height="120" fill="none" role="img" aria-label="beheld">
  <title>beheld</title>
  <!-- mark: brackets in ink, block cursor in signal green (spec §3.1) -->
  <g stroke="${INK}" stroke-width="7" stroke-linecap="square" stroke-linejoin="miter">
    <path d="M46 28 H30 V92 H46"/>
    <path d="M74 28 H90 V92 H74"/>
  </g>
  <g stroke="${SIGNAL_GREEN}" stroke-width="6" fill="none">
    <path d="M53 43V77"/>
    <path d="M67 43V77"/>
    <path d="M47 54H73"/>
    <path d="M47 66H73"/>
  </g>
  <!-- wordmark: JetBrains Mono outlines; the "b" carries the green highlight -->
  <g transform="${wordTransform}">
    <path d="${dRest}" fill="${INK}"/>
    <path d="${dB}" fill="${B_GREEN}"/>
  </g>
</svg>
`;
}

const buffer = await loadFont();
const font = opentype.parse(buffer);
const svg = build(font);
const out = join(dirname(fileURLToPath(import.meta.url)), "beheld-lockup.svg");
writeFileSync(out, svg);
console.log(`wrote ${out} (${svg.length} bytes)`);

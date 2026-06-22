// Brand color vocabulary for terminal output.
//
// The only chromatic element beheld ever paints is the cursor — the signal
// green (#58d36c). Everything else stays in the terminal's default ink. This
// module owns the truecolor sequence, its 256-color fallback, and the
// environment detection that decides whether we emit ANSI at all.
//
// Source of truth for the green: spec §1 / §2.2.

/** Signal green #58d36c as 24-bit (truecolor) ANSI. */
export const GREEN_TRUECOLOR = "\x1b[38;2;88;211;108m";
/** Closest xterm-256 index to #58d36c, used when truecolor is unavailable. */
export const GREEN_256 = "\x1b[38;5;42m";

export const RESET = "\x1b[0m";
export const DIM = "\x1b[2m";

export interface BrandEnv {
  /** stdout (or the chosen stream) is an interactive terminal. */
  tty: boolean;
  /** Whether any ANSI should be emitted (tty && !NO_COLOR). */
  color: boolean;
  /** Terminal advertises 24-bit color via $COLORTERM. */
  truecolor: boolean;
  /** Columns available; falls back to 80 when unknown. */
  width: number;
}

type ColorStream = { isTTY?: boolean; columns?: number };

/**
 * Inspect the runtime to decide how (and whether) to colorize.
 *
 * Rules (spec §2.2):
 *   - NO_COLOR set (non-empty) OR not a TTY  → no ANSI at all.
 *   - $COLORTERM present                     → truecolor, else 256-color.
 *
 * Pass an explicit stream/env in tests for deterministic output.
 */
export function detectBrandEnv(
  stream: ColorStream = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): BrandEnv {
  const tty = !!stream.isTTY;
  const noColor = env.NO_COLOR !== undefined && env.NO_COLOR !== "";
  const colorterm = env.COLORTERM;
  return {
    tty,
    color: tty && !noColor,
    truecolor: colorterm !== undefined && colorterm !== "",
    width: stream.columns ?? 80,
  };
}

/** The green opening sequence for this environment ("" when color is off). */
export function greenSeq(env: BrandEnv): string {
  if (!env.color) return "";
  return env.truecolor ? GREEN_TRUECOLOR : GREEN_256;
}

/** RESET, but only when we actually opened a color sequence. */
export function resetSeq(env: BrandEnv): string {
  return env.color ? RESET : "";
}

/** DIM open sequence ("" when color is off). */
export function dimSeq(env: BrandEnv): string {
  return env.color ? DIM : "";
}

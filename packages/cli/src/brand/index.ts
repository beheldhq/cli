// Brand surface for the CLI. Terminal output is the primary surface (see
// mark.ts / colors.ts); the SVG + PNG assets for artifacts and hosted markdown
// live in `assets/brand/`.
export {
  mark,
  lockup,
  lockupMid,
  banner,
  CURSOR,
} from "./mark";
export {
  detectBrandEnv,
  greenSeq,
  resetSeq,
  dimSeq,
  GREEN_TRUECOLOR,
  GREEN_256,
  RESET,
  DIM,
  type BrandEnv,
} from "./colors";

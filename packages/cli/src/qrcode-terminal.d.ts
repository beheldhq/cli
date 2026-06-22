/**
 * Ambient declaration for `qrcode-terminal` (no shipped types, no @types pkg).
 * Covers only the surface used by bundle/share.ts: the default export's
 * `generate(text, opts?, cb?)` that renders a unicode QR to a string.
 */
declare module "qrcode-terminal" {
  interface GenerateOptions {
    small?: boolean;
  }
  function generate(
    text: string,
    opts?: GenerateOptions,
    callback?: (output: string) => void,
  ): void;
  const qrcodeTerminal: { generate: typeof generate };
  export default qrcodeTerminal;
}

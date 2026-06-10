/**
 * Type shims for Bun's asset-as-file imports.
 *
 * Bun lets you import binary assets with `{ type: "file" }` and receive a
 * virtual path string that's usable with `Bun.file()`. TypeScript has no
 * concept of this — declare the modules here so the engine extractor
 * compiles cleanly even before `scripts/build.sh` materializes the
 * placeholder binary at `packages/cli/assets/beheld-engine`.
 */
declare module "*beheld-engine" {
  const path: string;
  export default path;
}

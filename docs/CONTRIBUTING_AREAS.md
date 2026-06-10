# Where to contribute

This is the public side of Beheld. The areas below are where outside
contributions land most easily. Anything that touches scoring methodology
needs coordination with the closed engine repo — that's called out
explicitly at the end.

## Good first contributions

- **New harness collector.** If you use a coding harness that Beheld
  doesn't recognize yet, add a collector for it. Existing collectors
  live in `packages/cli/src/lib/` (e.g. `tail-copilot-cli.ts`,
  `windsurf-hooks.ts`). The pattern is: install hooks or read the
  harness's local log, normalize events to the Beheld event interface,
  hand them to the MCP server. Include a fixture file under
  `packages/cli/tests/fixtures/` and a test that walks the fixture end
  to end.
- **Sanitizer patterns.** The sanitizer in `packages/mcp-server/src/`
  redacts a curated list of secret patterns. If you find one we miss —
  a new token format, a new auth scheme — add it with a test that
  proves the redaction works.
- **Doctor checks.** `beheld doctor` is meant to diagnose every common
  failure mode in under a second. Each check lives in
  `packages/cli/src/commands/doctor.ts`. If you debug something the
  doctor didn't catch, file an issue with the symptoms and consider
  adding a check.
- **Install runner steps.** `beheld init` and `beheld bootstrap` walk a
  scripted set of steps in `packages/cli/src/install/`. New harness
  wire-ups, OS-specific autostart variants, and recovery flows all live
  here.

## i18n

The CLI uses a small in-house i18n layer in `packages/cli/src/i18n/`.
`en` is the default and is always complete. If you want to ship a new
language:

1. Add a locale file in the same shape as `en.ts`.
2. Translate user-facing strings (UI, errors, prompts). Leave log lines
   in English unless they're shown to the user directly.
3. Wire the locale into the loader. The CLI auto-detects `LANG` /
   `LC_ALL` on start.

Partial translations are accepted — missing keys fall back to `en`.

## MCP tools

`packages/mcp-server/src/tools/` holds the tool implementations that
hosts like Claude Code, Continue.dev, and Cursor call. New tools are
welcome when they expose information that's useful inside the host (e.g.
"the user's current coach guidance for this project"). Each tool needs:

- A typed input/output schema.
- An entry in the server's tool registry.
- A short test that exercises the happy path.

## Areas that require engine coordination

Anything below changes how scores are computed, so the implementation
lives in the proprietary `beheldhq/engine` repo. Design discussions are
welcome here — file an issue or open a discussion — but the code lands
in the engine.

- **New scoring dimensions.** The current four are
  `prompt_quality`, `test_maturity`, `tech_breadth`, `growth_rate`.
  Adding a fifth requires engine work plus a contract version bump.
- **Tweaks to existing scorers.** Weights, normalization, decay
  windows.
- **New classifier categories.** Project category and workflow pattern
  taxonomies live in the engine.
- **Coach pattern library.** The library of detected patterns and their
  guidance messages is engine-side.
- **AI insight prompts and models.** Wording, context, model choice.

If you propose engine work, please include in the issue:

1. The signal you'd surface.
2. The data you'd need from L1 / L2.
3. Whether it requires a new event field (which would land in this repo).

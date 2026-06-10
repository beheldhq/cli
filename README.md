# Beheld

Privacy-first developer profiling. Beheld reads your git history and quietly observes your coding harness (Claude Code, Continue.dev, Cursor, Copilot, Windsurf) to compute four developer scores — without ever storing prompts, file contents, or secrets.

Ships as a single signed binary. No Node.js, Python, or npm required on the host.

```sh
curl -fsSL https://beheld.dev/install | sh
beheld
```

## Why Beheld

Most developer analytics tools either look at the wrong thing (lines of code) or extract too much (your conversations, your source). Beheld takes a different stance.

- **L1, the core, is your git history.** A profile forms from day one by importing repos you already have. No harness needed.
- **L2, the enrichment, is metadata about how you work.** Tool names, command names, file extensions, durations, prompt character counts. Never the content itself.
- **Everything stays local.** Data lives under `~/.beheld/` at mode `700`. The only optional outbound call is AI insights — opt-in, and only anonymized scores leave the machine.
- **The sanitizer runs before any write.** API keys, env values, bearer tokens, raw paths — stripped at the boundary. There is no second chance to leak.

What this means in practice:

| Beheld stores | Beheld never stores |
| --- | --- |
| Bash command names (sanitized) | Conversation text or prompts |
| File extensions (`.ts`, `.py`, …) | File contents |
| Tool sequences (Read, Edit, Bash…) | Secrets, tokens, API keys |
| Timestamps and durations | Absolute paths (SHA-256 hash only) |
| Ecosystem presence booleans | Business data or PII |

See [docs/PRIVACY.md](./docs/PRIVACY.md) for the full guarantee.

## Install

> Both install paths land with the `v0.5.0` release.

### Install script

```sh
curl -fsSL https://beheld.dev/install | sh
```

Downloads the binary for your platform, verifies the SHA-256 checksum and signature, installs it to `~/.local/bin/beheld`, and runs `beheld bootstrap`.

### Homebrew

```sh
brew install beheldhq/tap/beheld
```

### From source

```sh
git clone https://github.com/beheldhq/cli
cd cli
bun install
bun run build         # → dist/beheld
./dist/beheld bootstrap
```

The from-source path uses a dev stub for the scoring engine. The real engine lives in a separate private repository — see [the open-core boundary](#open-core-boundary).

## Quick start

```sh
beheld bootstrap      # L1-first onboarding: prep ~/.beheld/, generate keys
beheld import         # import git history (one repo at a time, or --github / --gitlab)
beheld init           # wire Claude Code + Continue.dev hooks
beheld view           # see your profile
```

Run `beheld bootstrap --import` to chain straight into the import wizard.

Once initialised, type `/beheld` in any Claude Code chat to see your live profile from inside the editor.

## The four scores

| Dimension | What it measures |
| --- | --- |
| **Prompt quality** | Context richness, tool variety, iteration depth (L2 only) |
| **Test maturity** | TDD adoption, test commands run, test-to-source ratio |
| **Tech breadth** | Ecosystems, platforms, and languages touched |
| **Growth rate** | 30-day delta across the other three dimensions |

Each score is 0–100. Dimensions absent from the available enrichment surface as `null` rather than fake zeros — the bundle declares which signals it had access to, so a reader can trust what they see.

## Harness support

| Harness | Capture fidelity | Status |
| --- | --- | --- |
| Claude Code | `native_hook` (PreToolUse, PostToolUse, Stop) | Supported |
| Continue.dev | `editor_extension` (MCP events) | Supported |
| Cursor | `local_log_tail` | Supported |
| Copilot CLI | `statusline` | Supported |
| Copilot VS Code | `local_log_tail` | Supported |
| Windsurf | `native_hook` | Supported |

Run `beheld harness list` to see which are detected on your machine, then `beheld harness install` to wire them up.

## Open-core boundary

This repository (`github.com/beheldhq/cli`) is Apache 2.0 and contains everything that runs on your machine that handles your data: the CLI, the MCP server, the bundle format, the sanitizer, the harness collectors.

The scoring engine — the model that turns raw events into the four scores — lives in a separate private repository, `github.com/beheldhq/engine`. It ships as a PyInstaller binary bundled inside the CLI binary and extracted to `~/.beheld/bin/engine` on first run.

Why the split:

- **The data path is open.** You can audit every byte that gets written, every redaction the sanitizer performs, every field that ends up in a bundle.
- **The scoring is proprietary.** The model is what makes Beheld differentiated; keeping it closed lets us invest in it sustainably.
- **The contract is public.** [`packages/engine`](./packages/engine) contains the type contracts plus a dev stub, so this repo builds and tests end-to-end without the real engine.

If a contribution requires changes to scoring logic, file a design proposal here. The implementation will land in the engine repo, but the discussion stays in the open.

## Documentation

- [Architecture](./docs/ARCHITECTURE.md) — the L1/L2 model, the four-layer stack, ports, runtime files
- [Privacy](./docs/PRIVACY.md) — what is and is not collected, the sanitizer, opt-in network
- [Commands reference](./docs/COMMANDS.md) — every CLI command with flags and examples
- [Contributing areas](./docs/CONTRIBUTING_AREAS.md) — where new collectors, sanitizer patterns, and i18n live

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The short version: `bun install`, `bun test`, `bun run build`. Issues and PRs welcome.

## Security

Report vulnerabilities to `security@beheld.dev` — do not file them as public issues. See [SECURITY.md](./SECURITY.md) for the full policy and disclosure timeline.

## Community

- Website: [beheld.dev](https://beheld.dev)
- Email: `hi@beheld.dev`
- Issues: [github.com/beheldhq/cli/issues](https://github.com/beheldhq/cli/issues)

## License

Apache License 2.0. See [LICENSE](./LICENSE).

The scoring engine in `github.com/beheldhq/engine` is proprietary and distributed only as a signed binary.

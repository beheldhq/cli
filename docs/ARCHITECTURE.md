# Architecture

Beheld builds a developer profile from two complementary sources: the
permanent record of what you've shipped (git history) and the live signal
of how you work (coding-harness metadata). It scores both into four
dimensions and serves the result to you locally.

This document covers the moving parts. For privacy guarantees see
[PRIVACY.md](./PRIVACY.md). For the command surface see
[COMMANDS.md](./COMMANDS.md).

## The L1 / L2 model

| Layer | Source | Role | Populated by |
| --- | --- | --- | --- |
| **L1 — core** | git commit history | Backbone of every profile. Available from day one. | `beheld import` / `beheld import-host` |
| **L2 — enrichment** | coding-harness session metadata (Claude Code, Continue.dev, Cursor, Copilot CLI, Copilot VSCode, Windsurf, Codex) | Adds behavior signal: tool sequences, timing, prompt length, project category. | `beheld init` (one-time wire-up) → events flow automatically |

A profile is valid with L1 alone. L2 sharpens dimensions like
`prompt_quality` and `growth_rate` that aren't visible in commits alone.
Every L2 source declares its `capture_fidelity` so the engine can weight
inputs honestly.

## Four-layer stack

```
┌───────────────────────────────────────────────┐
│  Collectors                                   │  packages/cli/src/lib/*
│  Claude Code · Continue · Cursor · Copilot …  │  hooks + MCP + log tails
└───────────────┬───────────────────────────────┘
                │ raw events
                ▼
┌───────────────────────────────────────────────┐
│  Sanitizer                                    │  packages/mcp-server/src/sanitizer
│  Strips secrets, env values, paths, prompts   │  runs before any write
└───────────────┬───────────────────────────────┘
                │ sanitized events
                ▼
┌───────────────────────────────────────────────┐
│  JSONL store · ~/.beheld/sessions/            │  daily rotation, 50 MB max
└───────────────┬───────────────────────────────┘
                │ batch read
                ▼
┌───────────────────────────────────────────────┐
│  Engine (HTTP :7338)                          │  packages/engine/ (open contract)
│  Extractors · classifiers · scorers · coach   │  packages/engine/contracts → real impl
└───────────────┬───────────────────────────────┘
                │ scores · summary · insights · coach
                ▼
┌───────────────────────────────────────────────┐
│  CLI (`beheld view`) and MCP tools            │  packages/cli/src/ui + commands
│  (`/beheld` slash command via MCP)            │  packages/mcp-server/src/tools
└───────────────────────────────────────────────┘
```

## Packages

- **`packages/cli/`** — the `beheld` command. Owns wizard, install runner,
  daemon supervisor, bundle format, identity, and the user-facing UI.
  Talks to the engine over HTTP and to the MCP server for status.
- **`packages/mcp-server/`** — the localhost MCP server on port 7337.
  Receives events from coding harnesses, runs the sanitizer, writes to the
  JSONL store. Also serves the `beheld`, `beheld_status`, and `beheld_coach`
  MCP tools that hosts call.
- **`packages/engine/`** — the open contract. Contains the TypeScript
  interfaces every endpoint must satisfy, plus a stub HTTP server for
  local development. The real engine that computes scores is proprietary
  and ships as a PyInstaller-bundled binary from a separate repo.

## Runtime layout

| Resource | Location |
| --- | --- |
| MCP server | `localhost:7337` |
| Scoring engine | `localhost:7338` |
| Sanitized events | `~/.beheld/sessions/YYYY-MM-DD_<uuid>.jsonl` |
| Profile store (SQLite) | `~/.beheld/profile.db` |
| Reader cursor | `~/.beheld/.cursor` |
| Daemon PID file | `~/.beheld/daemon.pid` |
| Daemon log | `~/.beheld/daemon.log` (10 MB rotation) |
| Config | `~/.beheld/config.json` |
| Extracted engine binary | `~/.beheld/bin/engine` |
| Identity keys | `~/.beheld/keys/` |

`~/.beheld/` is created at mode `700`; subdirectories follow. The CLI
self-corrects looser modes on every start.

## The open-core boundary

```
┌─────────────────────────────────────┬───────────────────────────────────────┐
│ Open (this repo, Apache 2.0)        │ Closed (beheldhq/engine, proprietary) │
├─────────────────────────────────────┼───────────────────────────────────────┤
│ Collectors (harness hooks)          │ Extractors                            │
│ Sanitizer (secret/path scrubbing)   │ Classifiers (project category, etc.)  │
│ Event format / JSONL writer         │ Four scorers                          │
│ Bundle wire format v7 + signing     │ Coach pattern library                 │
│ CLI + UI + MCP tools                │ AI insight generation                 │
│ Engine HTTP contract (open spec)    │ Engine HTTP server (real impl)        │
│ Installer / supervisor / doctor     │                                       │
└─────────────────────────────────────┴───────────────────────────────────────┘
```

The boundary sits at the HTTP contract in `packages/engine/contracts/`.
The CLI never imports engine internals — only contract types — so any
implementation that serves the documented endpoints can replace the
production engine.

## Bundle wire format (version 7)

`beheld snapshot` and `beheld share` emit a signed `.beheld` bundle. The
wire schema is **version 7** and pairs `core` (L1) with `enrichment` (L2)
keys. The same schema exists three times — TypeScript in
`packages/cli/src/bundle/types.ts`, Python in the engine's `models.py`,
TypeScript again in the web verifier — and the three must stay in sync.

Bundles are signed with ed25519 keys held under `~/.beheld/keys/`.
Verifiers (CLI `beheld verify`, the web viewer, and the portal) accept
any bundle whose signature matches the embedded public key and whose key
is registered with the platform (or trusted out-of-band).

## Supervisor and backoff

Two daemons run side by side: the MCP server (Bun) and the engine
(PyInstaller binary). The supervisor in `packages/cli/src/supervisor/`
restarts a daemon that goes down, but limits itself to a fixed number of
restarts within a rolling window. If the engine enters a repeated crash
loop the supervisor self-suspends and only `beheld start` clears the
state — preventing a fork-bomb in launchd or systemd auto-restart.

## Engine extraction

The CLI binary embeds the engine binary as an asset. On first run the
extractor unpacks it to `~/.beheld/bin/engine` (mode 755), code-signs ad-hoc
on macOS, then launches it. Subsequent runs reuse the extracted binary —
including across CLI upgrades, where the new CLI re-extracts.

In development builds the engine asset is a placeholder shell script.
Developers run the stub server from `packages/engine/stub/` directly on
:7338 instead — the CLI auto-detects and talks to whatever's listening.

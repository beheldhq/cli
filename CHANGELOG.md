# Changelog

All notable changes to the Beheld CLI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] — 2026-06-10

Inaugural public release of Beheld under the `beheldhq` GitHub organization.

### Added

- **Onboarding wizard.** `beheld bootstrap` runs the L1-first onboarding flow: prepares `~/.beheld/` at mode `700`, generates an Ed25519 keypair, and chains into `beheld import` with `--import`.
- **`beheld init` four-screen wizard.** Walks through what is collected, which score dimensions to enable, detected environments, and final hook installation.
- **Unified harness installer.** `beheld harness list` and `beheld harness install` cover six harnesses out of the box: Claude Code, Continue.dev, Cursor, Copilot CLI, Copilot VS Code, and Windsurf — each with a declared `capture_fidelity`.
- **MCP server.** Localhost-only HTTP server on port 7337. Exposes three tools to the host LLM: `beheld`, `beheld_coach`, `beheld_status`. Registered automatically by `beheld init`.
- **L1 git import.** `beheld import` ingests git history one repo at a time, or in bulk via `--github`, `--gitlab`, `--bitbucket`. Bare clones with `--filter=blob:none`, extracts metadata, discards working copy.
- **Coaching context.** `beheld view --coach` (and the `beheld_coach` MCP tool) returns deterministic pattern detection over the last 30 days of metrics. No LLM call, no external network.
- **Signed bundles.** `beheld snapshot` generates a `.beheld` bundle at wire format version 7, signed with Ed25519. `--share` uploads to the portal and returns a short URL plus QR code. `--html` produces a self-contained portrait page.
- **Sigstore Rekor integration.** Snapshots are submitted to the public transparency log by default; `--no-rekor` opts out. `beheld verify --verify-rekor` confirms the inclusion proof.
- **Offline verification.** `beheld verify <file>` validates schema, hash, and signature without network. `--chain` walks `previous_hash` links across snapshots.
- **Identity layer.** `beheld attest` and `beheld identity link` bind your Ed25519 public key to your GitHub identity. `beheld identity status` shows the current binding. `beheld auth` opens the portal dashboard with a signed challenge.
- **Diagnostics.** `beheld doctor` runs a full health check across daemons, PID file, codesign, JSONL store, and orphan events. Surfaces actionable failures with remediation hints.
- **Self-healing.** `beheld self-heal` (invoked by the Claude Code `SessionStart` hook) silently restores the `/beheld` slash command and MCP server entry if missing. The doctor pipeline invokes an internal engine self-heal that captures stacks, kills hung processes, and restarts the daemon.
- **Supervisor backoff.** Daemon manager applies exponential backoff between restarts to avoid tight crash loops, with a clean exit and operator-visible log when the limit is reached.
- **Key management.** `beheld keys show`, `beheld keys import` (JWK or PEM), and `beheld keys rotate` (archives previous pair; existing snapshots remain verifiable).
- **Update channel.** `beheld update` checks for a new release, verifies the SHA-256 checksum, and replaces the binary in place.

### Changed

- **Renamed from devprofile to Beheld.** All commands, file paths, and configuration keys moved from `devprofile` / `~/.devprofile/` to `beheld` / `~/.beheld/`. `beheld bootstrap` includes a legacy bridge that migrates leftover state.
- **GitHub organization moved from `eduardovrocha` to `beheldhq`.** The previous prototype repository is archived; this is a clean-slate v0.5.0 release.
- **Open-core split.** The scoring engine moved to a separate private repository (`beheldhq/engine`) and ships only as a signed binary. This repository now contains a contracts package plus a dev stub for local builds. See [the README](./README.md#open-core-boundary) for the rationale.

### Security

- **Sanitizer runs before any write.** Every event passes through pattern-based redaction for env var values, Anthropic API keys (`sk-…`), GitHub tokens (`ghp_…`), bearer tokens, and password fields. Tested with fixtures from every supported harness.
- **Localhost-only network by default.** No outbound calls without explicit user action. The portal upload (`snapshot --share`), Rekor submission, and AI insights are each opt-in or opt-out at the command flag level.
- **Sigstore signing on releases.** Release binaries are signed and published with a `.sha256` checksum and Sigstore bundle. The install script verifies both before executing.
- **Bundle Ed25519 signatures.** Every `.beheld` bundle carries its signature and public key; `beheld verify` validates offline.
- **File permissions enforced.** `~/.beheld/` is created at mode `700`; the keystore at `~/.beheld/keys/` at mode `600`. The doctor flags any drift.

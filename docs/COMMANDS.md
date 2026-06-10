# Commands reference

Every command supports `--help` for inline usage. The list below groups
commands by purpose.

## Setup

| Command | Purpose |
| --- | --- |
| `beheld bootstrap` | One-shot install: runs `init`, wires the supported harnesses, starts the daemons, prints the first view. |
| `beheld init` | Interactive wizard that picks dimensions, enables harnesses, and writes the local config. |
| `beheld harness list` | List the coding harnesses Beheld supports and which ones are wired up locally. |
| `beheld harness install [names…]` | Wire one or more harnesses (e.g. `claude-code continue cursor copilot-cli copilot-vscode windsurf codex`). With no arguments it installs every supported harness. |

## Daemon lifecycle

| Command | Purpose |
| --- | --- |
| `beheld start` | Start both daemons (MCP `:7337`, engine `:7338`). Idempotent — exits OK if already running. |
| `beheld stop` | Stop both daemons. |
| `beheld restart` | Stop then start. |
| `beheld status` | Print whether each daemon is healthy and the current PIDs. |
| `beheld doctor` | Full diagnostic: ports, PIDs, file modes, harness wire-ups, recent log errors. Use when something seems off. |
| `beheld self-heal` | Apply known fixes for common failure modes the doctor surfaces. |
| `beheld heal-engine` | Targeted recovery for an engine that's stuck or in a restart loop. |

## Viewing your profile

| Command | Purpose |
| --- | --- |
| `beheld view` | The default view. Scores, summary, recent insights. |
| `beheld view --scores-only` | Just the four numbers and the overall. |
| `beheld view --json` | Machine-readable output. |

## Importing git history (L1)

| Command | Purpose |
| --- | --- |
| `beheld import <path-or-url>` | Import commits from a single local clone or remote URL. |
| `beheld import-host` | Connect a GitHub / GitLab / Bitbucket account and import a chosen subset of your repos in one pass. |

## Bundle and sharing

| Command | Purpose |
| --- | --- |
| `beheld snapshot` | Emit a signed `.beheld` bundle representing the current profile. |
| `beheld snapshot list` | List previous snapshots in `~/.beheld/snapshots/`. |
| `beheld share` | Publish the latest snapshot to the Beheld portal. Returns a public URL. |
| `beheld verify <file>` | Verify a `.beheld` bundle's signature against the embedded public key. |
| `beheld attest` | Print the trust chain for the local install (identity key, registered platform). |

## Identity and keys

| Command | Purpose |
| --- | --- |
| `beheld identity` | Show the current identity (recovery email, public key fingerprint). |
| `beheld identity link` | Link the local identity to the platform account. |
| `beheld identity status` | Confirm the identity is recognized by the platform. |
| `beheld keys show` | Print the active public key. |
| `beheld keys import <path>` | Import a previously-exported keypair (recovery). |
| `beheld keys rotate` | Generate a new keypair and re-register with the platform. |

## Authentication

| Command | Purpose |
| --- | --- |
| `beheld auth` | Authenticate to the Beheld portal. Used internally by `share` and `identity link`. |

## Maintenance

| Command | Purpose |
| --- | --- |
| `beheld update` | Check for and install a newer release of the CLI binary. |
| `beheld delete` | Remove the install (see flags). |
| `beheld delete --profile` | Drop the SQLite profile but keep the install. |
| `beheld delete --all` | Stop daemons, remove `~/.beheld/`, unregister hooks. |
| `beheld migrate-legacy` | Migrate a profile created by an earlier prototype build. |

## Internal

| Command | Purpose |
| --- | --- |
| `beheld server` | Run the MCP server in the foreground. The supervisor uses this; you usually want `beheld start`. |

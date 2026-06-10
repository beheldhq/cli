# Privacy

Beheld is built so that the interesting data — what you're typing, the
files you're touching, the secrets in your environment — never leaves
your machine and is never written to disk in the first place. This
document explains exactly what's collected and what isn't.

## What is collected

| Item | Where it's stored |
| --- | --- |
| Tool names (`Bash`, `Read`, `Edit`, etc.) | `~/.beheld/sessions/*.jsonl` |
| File extensions (`.ts`, `.py`, `.rs`) | session events |
| Sanitized command strings (command + safe flags only) | session events |
| Session timing (start, end, duration) | session events + SQLite |
| Prompt length (character count — never content) | session events |
| Hashed working directory (SHA-256 of the path) | session events |
| `has_test_context` boolean | session events |
| Git commit metadata from L1 imports | SQLite (`profile.db`) |
| Computed scores (per day, four dimensions) | SQLite |
| Workflow patterns (`build` / `debug` / `refactor`) | SQLite aggregate |
| Project category (`backend` / `cli` / `web` / …) | SQLite aggregate |

## What is never collected

- **Prompt content.** The full text of what you typed to your coding
  assistant. Only the character count is recorded.
- **File content.** The bytes inside any file. Not before, not after, not
  diffs.
- **Raw file paths.** Working directories are hashed before storage. The
  raw path never appears in events or in the database.
- **Environment variable values.** The sanitizer strips them from every
  command before it's written.
- **API keys, tokens, passwords.** The sanitizer redacts known patterns
  (Anthropic `sk-…`, GitHub `ghp_…`, Bearer tokens, generic password
  fields) on every event. See the pattern list below.
- **Conversation history.** The MCP server processes events one at a time
  and never persists request/response bodies.
- **Anything outside `~/.beheld/`.** Beheld writes to its own directory
  and the install targets it knows about (Claude Code's settings file,
  Continue.dev's config file). Nothing else.

## The sanitizer

The sanitizer runs on every event before any write. Its current redaction
patterns:

- Environment variable values referenced in commands (e.g. `$HOME`,
  `${TOKEN}`).
- Anthropic API keys: `sk-ant-…`
- GitHub personal access tokens: `ghp_…`, `gho_…`, `ghu_…`, `ghs_…`
- HTTP Authorization headers: `Bearer …`, `Basic …`
- Common password fields in URLs (`https://user:pass@host`).
- Raw absolute paths inside commands and arguments — replaced with their
  SHA-256 prefix.

If a redaction pattern misses something, the event is still less leaky
than the raw command — but please report it via the security policy so we
can extend the patterns.

## Network behavior

Beheld holds to a **localhost by default** posture:

- The MCP server binds **only** to `127.0.0.1:7337`.
- The engine binds **only** to `127.0.0.1:7338`.
- No outbound traffic is initiated automatically.

The one exception is the AI insights feature. When enabled, the engine
sends only **scores and aggregated signals** — never events, never
prompts, never file content — to one of:

- Anthropic's API (`claude-sonnet-4-6`), if a user-provided API key is
  configured.
- A local Ollama server (`qwen2.5-coder:14b` by default), if running.

The opt-in is explicit (`beheld view --insights` prompts you) and the
exact payload is logged to `~/.beheld/daemon.log` for audit.

## File permissions

`~/.beheld/` is created at mode `700` (owner read/write/execute, no group,
no other). Subdirectories follow the same mode. The CLI self-corrects
looser permissions on every start — if you ever notice `~/.beheld/`
showing up at `755` after restoring from backup, just run `beheld start`
and it tightens itself.

## Deleting everything

```sh
beheld delete --all
```

This stops the daemons, removes `~/.beheld/`, unregisters MCP hooks from
Claude Code (`~/.claude/settings.json`) and Continue.dev
(`~/.continue/config.json`), removes the LaunchAgent plist on macOS or
the systemd unit on Linux, and verifies that nothing is listening on
:7337 or :7338 when it finishes.

To delete only the database while keeping the install:

```sh
beheld delete --profile
```

## Sharing

Bundles created with `beheld snapshot` or `beheld share` contain only
scores, summary, and the redacted profile signals — never raw events.
The signature proves the bundle came from your local install; the
contents are auditable line-by-line before you share.

When publishing to the Beheld portal, you may optionally include a
recovery email. That email is stored encrypted at rest on the portal,
used only to recover access if you lose your local keys, and is never
shared with employers, recruiters, or any third party.

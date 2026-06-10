# @beheld/engine

This package is the **open boundary** between the public Beheld CLI and the
proprietary scoring engine.

It contains two sub-packages:

| Package | Purpose |
| --- | --- |
| [`contracts/`](./contracts) | TypeScript interfaces describing every HTTP endpoint the engine exposes on `localhost:7338`. Re-exported by the CLI; consumed by anyone building against the engine. |
| [`stub/`](./stub) | A small Bun HTTP server that satisfies the contract with deterministic mock data. Use it when developing the CLI without the production engine. |

The **production engine** that computes real scores from your session data is
a Python application (PyInstaller-bundled) maintained in the private repo
[`beheldhq/engine`](https://github.com/beheldhq/engine). Public CLI builds
fetch the released engine binary at build time via
[`scripts/fetch-engine.sh`](../../scripts/fetch-engine.sh); local dev builds
use the stub.

## Why split it this way

The CLI, MCP server, sanitizer, and bundle format are open so anyone can
audit what's collected and how it leaves the machine. The scorer's
heuristics, dimension weights, and pattern library are the project's
differentiated IP and stay closed.

Splitting at the HTTP boundary keeps both sides honest:

- The CLI never imports engine internals.
- The engine has no opinion on how the CLI presents data.
- A third party can replace either side as long as the contract holds.

## Running the stub locally

```sh
bun run stub:engine
# or
bun run packages/engine/stub/index.ts
```

The CLI auto-detects `http://127.0.0.1:7338` and will use whatever's
listening there.

## Contract version

The current contract version is **0.5.0** (see
[`contracts/index.ts`](./contracts/index.ts)). Breaking changes require a
major bump and a corresponding engine release.

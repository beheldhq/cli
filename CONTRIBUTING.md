# Contributing to Beheld

Thanks for your interest. This document covers the dev loop, the repository boundary, and how to land a change.

## Dev setup

You need [Bun](https://bun.sh) `>= 1.1`. Everything else is optional.

```sh
git clone https://github.com/beheldhq/cli
cd cli
bun install
bun test
bun run build        # → dist/beheld (current platform)
./dist/beheld --version
```

The build produces a single standalone binary. Bun handles cross-compilation for releases (`--target=bun-darwin-arm64`, etc.) — see [.github/workflows](./.github/workflows) for the matrix.

### Running locally without the real engine

The proprietary scoring engine lives in a private repository (`beheldhq/engine`). For local development you do not need it: this repo ships a contracts-only package at [`packages/engine`](./packages/engine) with a dev stub.

```sh
bun run dev          # uses the stub — returns plausible scores deterministically
```

When you build with `bun run build`, the stub is what gets embedded. To build a release binary with the real engine, the CI pipeline downloads the engine artifact and substitutes it in before compilation.

If your change needs to call into engine code that does not yet exist in the stub, add a stub implementation in `packages/engine/src/stub/` that returns realistic-looking values. Keep the type contracts in `packages/engine/src/contracts/` in sync — that file is the source of truth shared with the engine repo.

## Code style

- TypeScript strict mode. No `any` without a comment explaining why.
- 2-space indent, single quotes, trailing commas where allowed.
- Prefer named exports. Default exports only at command entry points where commander requires it.
- Tests live alongside code (`*.test.ts`) and run with `bun test`.
- New CLI commands go in `packages/cli/src/commands/<name>.ts` with a thin entry in `packages/cli/src/index.ts`.

Run `bun run lint` and `bun test` before opening a PR.

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/). Examples:

```
feat(harness): add windsurf collector
fix(sanitizer): strip GitLab PAT pattern
docs(privacy): clarify hash function used for cwd
chore(deps): bump commander to 12.1.0
```

The CHANGELOG is updated as part of each release PR — you do not need to edit it directly.

## Pull request process

1. Open an issue first for anything larger than a one-line fix. This avoids wasted work if the approach needs discussion.
2. Branch from `main`. One logical change per PR.
3. Include tests for any behaviour change. The CI gate runs `bun test` on macOS and Linux.
4. Fill in the PR description: what changed, why, how to verify. Link the issue.
5. A maintainer will review within a few days. We squash-merge.

## What lives where

This repository contains everything that runs on a user's machine and handles their data: the CLI, the MCP server, the bundle format, the sanitizer, harness collectors, the doctor pipeline.

The scoring engine — the model that converts raw events into the four scores — lives in the private `beheldhq/engine` repository. If your change touches:

- **CLI behaviour, sanitizer patterns, harness collectors, MCP tools, bundle format** → this repo.
- **Scoring weights, new score dimensions, classifier logic, AI insight prompts** → propose here, implement there.

For the second category, open a design issue in this repo describing the change. A maintainer will create the corresponding engine PR and link it back.

## Where to file issues

- **Bugs, feature requests, documentation** → [github.com/beheldhq/cli/issues](https://github.com/beheldhq/cli/issues)
- **Security vulnerabilities** → `security@beheld.dev` (see [SECURITY.md](./SECURITY.md))
- **Conduct concerns** → `conduct@beheld.dev` (see [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md))

## Contributor License Agreement

No CLA is required for the `v0.5.0` release. Contributions are accepted under the Apache 2.0 license that covers this repository.

This may change in a future release as the project matures. If we adopt a CLA, existing contributions remain under the terms they were submitted under.

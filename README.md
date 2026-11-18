# terra-graph-conventions

Convention/provider packages for `terra-graph`, published as independent npm packages from a single monorepo.

## Packages

- `@terra-graph/conventions-aws`
- `@terra-graph/conventions-core`

## Requirements

- Node `24.22.3` (see `.nvmrc`)
- Yarn classic (`1.22.22`)

## Setup

```bash
yarn install --frozen-lockfile
```

## Commands

```bash
yarn lint
yarn lint:ci
yarn build
yarn test
```

## Releasing (Per Package)

Releases are automated by GitHub Actions using `semantic-release` per package.

Each package defines its own release config in `packages/<name>/.releaserc.cjs`, which
extends the shared `release.base.cjs` at the repo root.

Manual release for one package:

```bash
yarn release:package aws
```

Release tags are package-specific (example: `@terra-graph/conventions-aws@1.2.3`).

## Publishing

See [PUBLISHING.md](./PUBLISHING.md) for npm trusted publisher setup and release verification.

## Common verification

Use Node `24.22.3` from `.nvmrc` and Yarn `1.22.22` (`corepack enable`). Run `yarn install --frozen-lockfile`, then `yarn verify`. Verification runs read-only lint, explicit no-emit type checks, a clean build, and unit tests, followed by installed-tarball consumer checks. It may write ignored build and coverage artifacts, but must not change tracked files.

`yarn lint` and `yarn lint:ci` are read-only. `yarn format` explicitly rewrites formatting; builds do not format or fix source files. Lint coverage and rules remain repository-specific. Database integration tests and live model evaluations remain opt-in.

PRs run `yarn verify`. Existing release workflows require a successful verification job; monorepo release jobs verify again after synchronizing their checkout.

`yarn test:consumer` requires a completed build and registry access. It packs without lifecycle scripts, installs tarballs in temporary projects with declared peers and TypeScript/Node typings, checks runtime exports and consumer declarations, and always removes its temporary directory. Dual-format libraries are exercised through both import and require; ESM-only packages retain that contract.

No-emit checking resolves conventions-core source within this monorepo so a clean checkout does not require build artifacts before type checking. Package builds and consumer checks still use package exports and installed tarballs.

Development and packaged-consumer verification use published `@terra-graph/core@1.0.0`; no sibling core checkout is required.

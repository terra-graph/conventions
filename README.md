# terra-graph-conventions

Convention/provider packages for `terra-graph`, published as independent npm packages from a single monorepo.

## Packages

- `@terra-graph/conventions-aws`
- `@terra-graph/conventions-core`

## Requirements

- Node `20.19.6` (see `.nvmrc`)
- Yarn classic (`1.22.x`)

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

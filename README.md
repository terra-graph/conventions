# terra-graph-conventions

Convention/provider packages for `terra-graph`, published as independent npm packages from a single monorepo.

## Packages

- `@terra-graph-conventions/aws`

## Requirements

- Node `20.19.6` (see `.nvmrc`)
- Yarn classic (`1.22.x`)
- Local sibling clone of `terra-graph` at `../terra-graph`

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

Manual release for one package:

```bash
yarn release:package aws
```

Release tags are package-specific (example: `@terra-graph-conventions/aws@1.2.3`).

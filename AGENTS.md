# AGENTS.md

This file describes the agreed architecture, naming, and implementation conventions for `terra-graph-conventions`.

## Purpose

`terra-graph-conventions` is a monorepo. It defines packages that provide `RuntimeProvider` implementations for TerraGraph. Compatibility with core is declared by each package's `peerDependencies`; CLI and core major versions must not be assumed to correspond.

## Packages

This mono repo provides the following npm packages:

- `@terra-graph/conventions-core`: Includes generic non cloud provider specific conventions and provides the plugins for definig projections and semantics.
- `@terra-graph/conventions-aws`: AWS cloud specific plugins and conventions provided by rules and plugins

## Plugin Conventions

1. Build contract:
- Plugin classes extend `GraphPlugin<TOptions>`.
- `build(input)` should return only plugin-local additions (`namedRules`, `namedRuleSets`, `phases`) and avoid mutating registries directly.

2. Naming and references:
- Plugin-local rule and ruleset names should be local/readable; resolver will prefix them with `plugin.name`.
- References inside plugin rule sets and phases should use local names; resolver rewrites them to prefixed names.

3. Options:
- Keep option shapes strict and serializable.
- Apply defaults inside plugin options resolution, and validate enum/boolean inputs with explicit errors.

## Code Style Guidance
- Do not use imports from index.ts / index.js files
- Verify with `yarn lint:ci`. Use `yarn lint` for intended formatting fixes and inspect the diff.
- Prefer OOP patterns and classes over functional
- For architectural contracts (for example `RuntimeConfigSource`, `RuntimeConfigParser`, `RuntimeConfigValidator`):
  - Keep the interface and supporting types in a module with the same name (for example `src/Runtime/RuntimeConfigSource.ts`).
  - Place concrete implementations in a sibling folder with the same name as the contract module (for example `src/Runtime/RuntimeConfigSource/FileRuntimeConfigSource.ts`).
  - Favor one class per module and use named exports for classes.

## Setup and validation

Use Node `20.19.6` from `.nvmrc` and Yarn `1.22.22`. The CI matrix additionally checks other Node versions; release tooling uses its workflow's runtime.

This checkout currently requires a sibling core checkout at `../core` because of the root package resolution. Build core there first. From this repository run `yarn install --frozen-lockfile`, `yarn lint:ci`, `yarn build`, and `yarn test`.

Colocate new `.test.ts` files with their implementations. Describe public methods as `ClassName.methodName` and retain the existing `shoud` test naming convention. Keep interfaces and their supporting types together, use explicit types, and preserve strict serializable configuration shapes.

# AGENTS.md

This file describes the agreed architecture, naming, and implementation conventions for `terra-graph-conventions`.

## Purpose

`terra-graph-conventions` is a monorepo. It defines packages that provide `RuntimeProviders` for `terra-graph` (v2 and above).

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
- Always use `yarn lint` to ensure code is linted correctly
- Prefer OOP patterns and classes over functional
- For architectural contracts (for example `RuntimeConfigSource`, `RuntimeConfigParser`, `RuntimeConfigValidator`):
  - Keep the interface and supporting types in a module with the same name (for example `src/Runtime/RuntimeConfigSource.ts`).
  - Place concrete implementations in a sibling folder with the same name as the contract module (for example `src/Runtime/RuntimeConfigSource/FileRuntimeConfigSource.ts`).
  - Favor one class per module and use named exports for classes.

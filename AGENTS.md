# AGENTS.md

This file describes the agreed architecture, naming, and implementation conventions for `terra-graph-conventions`.

## Purpose

`terra-graph-conventions` is a monorepo. It defines packages that provide `RuntimeProviders` for `terra-graph` (v2 and above).

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

## Testing Conventions

1. Test files
- Test files should live in the same directory as the file they contain tests for and have the same file name except with a `.test.ts` extension.

2. Describe structure:
- Each `describe` targets one public method:
- Format: `describe('ClassName.methodName', () => { ... })`.

3. Test naming:
- `it('shoud ...')` pattern is used in current tests and should be kept consistent.

4. Running tests
- If the default Node version is too old, use `nvm` to select Node `20.19.6`.

## Type Safety and Style

- Prefer explicit types and generics over `any`.
- Keep constructor and config shapes strict and predictable.
- Favor small, composable objects that serialize cleanly.

## Code Style Guidance
- Do not use imports from index.ts / index.js files
- Always use `yarn lint` to ensure code is linted correctly
- Prefer OOP patterns and classes over functional
- For architectural contracts (for example `RuntimeConfigSource`, `RuntimeConfigParser`, `RuntimeConfigValidator`):
  - Keep the interface and supporting types in a module with the same name (for example `src/Runtime/RuntimeConfigSource.ts`).
  - Place concrete implementations in a sibling folder with the same name as the contract module (for example `src/Runtime/RuntimeConfigSource/FileRuntimeConfigSource.ts`).
  - Favor one class per module and use named exports for classes.

# AGENTS.md

## Task workspaces and branches

- Start each new change in a dedicated Git worktree on a task branch based on freshly fetched `origin/main`. This applies to implementation, documentation, maintenance and configuration. Reuse the same worktree for follow-ups on the same task; independent tasks need separate worktrees. Never change files on main or switch another task's checkout.
- In the assembled TerraGraph workspace, identify affected repositories from the workspace root and use its `scripts/task-workspace` command to create the task workspace or add this repository. The root workspace instructions and task-workspace skill describe that setup. Do not require the private workspace when working in a standalone clone.
- For a standalone clone, run `git fetch origin`, then `git worktree add --no-track -b <task-branch> <separate-task-path> origin/main`. Read the new checkout's instructions and continue there using explicit working directories and file paths. Creating the worktree is part of the requested change; no separate routine confirmation is needed.
- A shell directory change does not rebind VS Code, agent instructions or sandbox permissions. Map original editor file references to the task checkout before editing. Preserve existing changes and do not share writable source, dependencies or build output through symlinks. Use normal narrowly scoped permission requests if access is blocked.
- Before handoff or push, inspect `git branch -vv` in each affected repository. Unpublished task branches have no upstream; published branches track the matching branch on the intended remote. Remove accidental base-branch tracking with `git branch --unset-upstream`. For a first authorized push, use `git push --set-upstream origin <task-branch>`. Do not push or remove task worktrees without authorization.

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
- Verify with `yarn lint:ci`. Use `yarn format` for intended formatting writes and inspect the diff.
- Prefer OOP patterns and classes over functional
- For architectural contracts (for example `RuntimeConfigSource`, `RuntimeConfigParser`, `RuntimeConfigValidator`):
  - Keep the interface and supporting types in a module with the same name (for example `src/Runtime/RuntimeConfigSource.ts`).
  - Place concrete implementations in a sibling folder with the same name as the contract module (for example `src/Runtime/RuntimeConfigSource/FileRuntimeConfigSource.ts`).
  - Favor one class per module and use named exports for classes.

## Setup and validation

Use Node `24.22.3` from `.nvmrc` and Yarn `1.22.22`. CI and release workflows use the tracked `.nvmrc` baseline.

Development dependencies use published core packages; a sibling checkout is not required. From this repository run `yarn install --frozen-lockfile`, `yarn lint:ci`, `yarn build`, and `yarn test`.

Colocate new `.test.ts` files with their implementations. Describe public methods as `ClassName.methodName` and retain the existing `shoud` test naming convention. Keep interfaces and their supporting types together, use explicit types, and preserve strict serializable configuration shapes.

## Verification entry point

Use `yarn verify` for complete verification on Node `24.22.3`. It runs lint, no-emit type checking, a clean build, tests, and isolated packaged-consumer checks. `yarn lint` and `yarn lint:ci` never rewrite files; `yarn format` does. Verification must leave tracked files unchanged. Preserve existing lint coverage and do not weaken checks to make a release pass. See README.md for the staged registry dependency rollout where applicable.

# Publishing

Releases run automatically through `.github/workflows/release.yml` using semantic-release and npm trusted publishing (OIDC). Use Node `24.22.3` (`nvm install && nvm use`) and Yarn `1.22.22` (`corepack enable`). Install with `yarn install --frozen-lockfile`.

## Configure GitHub release authentication and branch rules

Releases push version and changelog commits using a dedicated GitHub App. Configure this before merging the workflow changes:

1. Under the owning organization's Settings → Developer settings → GitHub Apps, register an organization-owned release App. Use the organization's URL as its homepage, disable webhooks, leave user authorization disabled, and allow installation only on this account.
2. Grant repository **Contents**, **Issues**, and **Pull requests** read/write permissions (Metadata read access is automatic). Install the App only on repositories it publishes, including this repository. No organization or Actions administration permissions are needed.
3. Record its **Client ID** as the Actions variable `RELEASE_APP_CLIENT_ID`. Generate a private key and store its complete PEM contents as the Actions secret `RELEASE_APP_PRIVATE_KEY`. Organization-level values can be shared with selected publishing repositories; repository-level values also work. Do not commit the key. Each release job creates a short-lived token scoped to its current repository and revokes it at job completion.
4. In every applicable branch ruleset, add this App to the bypass list with **Always** access. PR-only bypass cannot authorize direct release commits. Resolve any older branch protection rules that would still block the App; rulesets do not override them. Include the App in any tag ruleset that restricts creation of release tags.
5. Require `Verify` from **GitHub Actions** on protected branches; `Release verification` is a separate post-merge job. Protect the default branch and the release branches in this repository (`rc/*`, and `1.x` where configured). Require PRs and conversation resolution, block force pushes and deletion, and require branches to be up to date. Use zero approvals for a sole maintainer, or one approval with another reviewer. Leave **Restrict updates** disabled.

The publishing checkout persists the App token for Git pushes, and semantic-release receives it as `GITHUB_TOKEN`. Verification and package detection retain the ordinary read-only workflow token. Package publishing authentication remains separate. Existing semantic-release commits include `[skip ci]` to prevent recursive push workflows; any additional automated branch commits must do the same. Do not add skip markers to normal PR commits because required CI checks would remain pending.

Configure the App and Actions values first, merge the workflow changes, confirm the `Verify` check on a fresh PR, then activate the rulesets. Validate the App's release commits, tags, and package publication on the next intentional release; do not publish merely to test configuration. See [App token action](https://github.com/actions/create-github-app-token) and [GitHub rulesets](https://docs.github.com/en/organizations/managing-organization-settings/creating-rulesets-for-repositories-in-your-organization).

Also require `Commitlint` from GitHub Actions for this repository. If it is enforced in a separate ruleset, add the release App to that ruleset’s **Always** bypass list too.

## Configure npm

For each package (`@terra-graph/conventions-core`, `@terra-graph/conventions-aws`), open its npm Settings → Trusted publishing and configure:

- Provider: GitHub Actions
- Organization: `terra-graph`
- Repository: `conventions`
- Workflow filename: `release.yml`
- Environment: leave empty
- Allowed actions: enable direct `npm publish` and `npm dist-tag` management.

Create the configuration when a real release is ready: its first successful publish must occur within two days. Package repository metadata must match this GitHub repository. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

No npm publishing token is required in Actions. A short-lived GitHub App token authorizes release commits, tags, and GitHub integration through the `GITHUB_TOKEN` environment variable. Existing release branches, channels, and tag formats are preserved. Monorepo releases run inside the selected workspace so commit filtering and release assets refer to that package.

## Verify and retire tokens

Run the repository's documented checks and `yarn exec -- npm --version` (expected `11.21.2`). Inspect built package contents using `yarn exec -- npm pack --dry-run` from the package directory. A dry run cannot establish successful OIDC publishing.

For the first real release, verify the Actions OIDC authentication log, published version, distribution tag, package contents, and npm provenance linked to the expected repository and workflow. For monorepos, verify every package separately. Workflow-only changes do not select packages for the release matrix; coordinate setup with the next release-worthy package change.

After successful verification, select npm Publishing access → Require two-factor authentication and disallow tokens. Remove obsolete repository `NPM_TOKEN` secrets. Before revoking any token or removing an organization secret, check that other repositories do not use it. Account configuration and live releases are maintainer actions.

## Verification gate

Run `yarn verify` before proposing a release. Release jobs depend on full verification, including installed-tarball checks. Monorepo jobs repeat verification after branch synchronization. Repair failures or complete the producer dependency rollout before publishing; do not bypass the gate.

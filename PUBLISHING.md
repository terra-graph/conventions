# Publishing

Releases run automatically through `.github/workflows/release.yml` using semantic-release and npm trusted publishing (OIDC). Use Node `24.22.3` (`nvm install && nvm use`) and Yarn `1.22.22` (`corepack enable`). Install with `yarn install --frozen-lockfile`.

## Configure npm

For each package (`@terra-graph/conventions-core`, `@terra-graph/conventions-aws`), open its npm Settings → Trusted publishing and configure:

- Provider: GitHub Actions
- Organization: `terra-graph`
- Repository: `conventions`
- Workflow filename: `release.yml`
- Environment: leave empty
- Allowed actions: enable direct `npm publish` and `npm dist-tag` management.

Create the configuration when a real release is ready: its first successful publish must occur within two days. Package repository metadata must match this GitHub repository. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

No npm publishing token is required in Actions. `GITHUB_TOKEN` still authorizes release commits, tags, and GitHub integration. Existing release branches, channels, and tag formats are preserved. Monorepo releases run inside the selected workspace so commit filtering and release assets refer to that package.

## Verify and retire tokens

Run the repository's documented checks and `yarn exec -- npm --version` (expected `11.21.2`). Inspect built package contents using `yarn exec -- npm pack --dry-run` from the package directory. A dry run cannot establish successful OIDC publishing.

For the first real release, verify the Actions OIDC authentication log, published version, distribution tag, package contents, and npm provenance linked to the expected repository and workflow. For monorepos, verify every package separately. Workflow-only changes do not select packages for the release matrix; coordinate setup with the next release-worthy package change.

After successful verification, select npm Publishing access → Require two-factor authentication and disallow tokens. Remove obsolete repository `NPM_TOKEN` secrets. Before revoking any token or removing an organization secret, check that other repositories do not use it. Account configuration and live releases are maintainer actions.

## Verification gate

Run `yarn verify` before proposing a release. Release jobs depend on full verification, including installed-tarball checks. Monorepo jobs repeat verification after branch synchronization. Repair failures or complete the producer dependency rollout before publishing; do not bypass the gate.

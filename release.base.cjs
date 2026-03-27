module.exports = ({ packageDir, packageName, scope }) => ({
    branches: [
    'main',
    {
      "name": "rc/*",
      "prerelease": "rc"
    }
  ],
  extends: ['semantic-release-monorepo'],
  tagFormat: `${packageName}@\${version}`,
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'conventionalcommits',
      },
    ],
    [
      '@semantic-release/release-notes-generator',
      {
        preset: 'conventionalcommits',
      },
    ],
    [
      '@semantic-release/changelog',
      {
        changelogFile: `${packageDir}/CHANGELOG.md`,
      },
    ],
    [
      '@semantic-release/npm',
      {
        pkgRoot: packageDir,
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: [`${packageDir}/package.json`, `${packageDir}/CHANGELOG.md`],
        message: `chore(${scope}): release \${nextRelease.version} [skip ci]\n\n\${nextRelease.notes}`,
      },
    ],
  ],
});

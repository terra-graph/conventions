const createReleaseConfig = require('../../release.base.cjs');

module.exports = createReleaseConfig({
  packageDir: 'packages/core',
  packageName: '@terra-graph/conventions-core',
  scope: 'core',
});

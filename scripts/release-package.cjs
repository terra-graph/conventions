const { spawnSync } = require('node:child_process');

const input = process.argv[2] ?? process.env.PACKAGE;
if (!input) {
  process.stderr.write('Usage: yarn release:package <workspace-scope>\n');
  process.stderr.write('Example: yarn release:package aws\n');
  process.exit(1);
}

const workspace = input.startsWith('@') ? input : `@terra-graph-conventions/${input}`;

const result = spawnSync('yarn', ['workspace', workspace, 'semantic-release'], {
  stdio: 'inherit',
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}

process.exit(1);

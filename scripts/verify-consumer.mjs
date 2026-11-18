import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
const repository = manifest(root);
const workspaces = repository.workspaces
  ? readdirSync(join(root, 'packages'))
      .map((name) => join(root, 'packages', name))
      .filter((dir) => existsSync(join(dir, 'package.json')))
  : [root];
const temporary = mkdtempSync(join(tmpdir(), 'terragraph-consumer-'));
const run = (command, args, cwd = temporary) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
const target = (entry, condition) =>
  typeof entry === 'string'
    ? entry
    : (entry?.[condition]?.default ?? entry?.[condition] ?? entry?.default);
try {
  const dependencies = {
    typescript: repository.devDependencies.typescript,
    '@types/node': repository.devDependencies['@types/node'] ?? '^22.13.10',
  };
  for (const dir of workspaces) {
    const pkg = manifest(dir);
    const packed = JSON.parse(
      run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], dir),
    )[0];
    dependencies[pkg.name] = join(temporary, packed.filename);
    for (const [name, version] of Object.entries(pkg.peerDependencies ?? {})) {
      if (pkg.devDependencies?.[name] || !pkg.peerDependenciesMeta?.[name]?.optional)
        dependencies[name] ??= pkg.devDependencies?.[name] ?? version;
    }
  }
  // Local tarballs must win over peer versions regardless of workspace order.
  for (const dir of workspaces) {
    const pkg = manifest(dir);
    const tarball = readdirSync(temporary).find(
      (name) => name === `${pkg.name.replace('@', '').replaceAll('/', '-')}-${pkg.version}.tgz`,
    );
    assert.ok(tarball, `Missing tarball for ${pkg.name}`);
    dependencies[pkg.name] = join(temporary, tarball);
  }
  writeFileSync(
    join(temporary, 'package.json'),
    JSON.stringify({ private: true, type: 'module', dependencies }),
  );
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false']);
  for (const dir of workspaces) {
    const pkg = manifest(dir);
    const installed = join(temporary, 'node_modules', pkg.name);
    const exports = pkg.exports ?? { '.': { import: pkg.main } };
    const imports = [];
    const requires = [];
    for (const [key, entry] of Object.entries(exports)) {
      for (const condition of ['import', 'require']) {
        const destination = target(entry, condition);
        if (!destination) continue;
        const matches = destination.includes('*')
          ? files(installed)
              .map((path) => `./${relative(installed, path).split('\\').join('/')}`)
              .filter(
                (path) =>
                  path.startsWith(destination.split('*')[0]) &&
                  path.endsWith(destination.split('*')[1]),
              )
          : [destination];
        assert.ok(matches.length, `Empty export ${pkg.name}/${key}`);
        for (const path of matches) {
          assert.ok(existsSync(join(installed, path)), `Missing export ${path}`);
          if (!path.endsWith('.js')) continue;
          const replacement = destination.includes('*')
            ? path.slice(destination.indexOf('*'), path.length - destination.split('*')[1].length)
            : '';
          const specifier = pkg.name + (key === '.' ? '' : key.slice(1).replace('*', replacement));
          (condition === 'import' ? imports : requires).push(specifier);
        }
      }
    }
    for (const [extension, specifiers] of [
      ['mts', imports],
      ['cts', requires],
    ]) {
      if (!specifiers.length) continue;
      const runtime = specifiers
        .map((specifier, index) =>
          extension === 'mts'
            ? `const m${index} = await import(${JSON.stringify(specifier)});`
            : `const m${index} = require(${JSON.stringify(specifier)});`,
        )
        .join('\n');
      const expected =
        pkg.name === '@terra-graph/core'
          ? 'GraphPluginRegistry'
          : pkg.name === '@terra-graph/terra-graph'
            ? 'defaultRuntimeCatalog'
            : pkg.name === '@terra-graph/auto-projections'
              ? 'AutoProjectionPlugin'
              : pkg.name === '@terra-graph/icons-aws'
                ? 'AwsIcon'
                : 'default';
      const rootIndex = specifiers.indexOf(pkg.name);
      assert.ok(rootIndex >= 0, `Missing root export for ${pkg.name}`);
      writeFileSync(
        join(temporary, `consumer.${extension === 'mts' ? 'mjs' : 'cjs'}`),
        `${runtime}\nif (!m${rootIndex}[${JSON.stringify(expected)}]) throw Error('Missing public symbol ${expected}');\n`,
      );
      run(process.execPath, [`consumer.${extension === 'mts' ? 'mjs' : 'cjs'}`]);
      writeFileSync(
        join(temporary, `consumer.${extension}`),
        `${specifiers
          .map(
            (specifier, index) =>
              `import * as m${index} from ${JSON.stringify(specifier)}; void m${index};`,
          )
          .join('\n')}\nvoid m${rootIndex}[${JSON.stringify(expected)}];\n`,
      );
      run(process.execPath, [
        'node_modules/typescript/bin/tsc',
        '--noEmit',
        '--strict',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--target',
        'ES2022',
        `consumer.${extension}`,
      ]);
    }
    if (pkg.bin) {
      const binary = join(temporary, 'node_modules', '.bin', 'terra-graph');
      const help = run(binary, ['--help']);
      assert.match(help, /terra-graph/);
      const commandFiles = files(join(installed, 'dist', 'commands')).filter((path) =>
        path.endsWith('.js'),
      );
      assert.ok(commandFiles.length, 'No packaged CLI commands found');
      for (const path of commandFiles) {
        const command = relative(join(installed, 'dist', 'commands'), path)
          .replace(/\.js$/, '')
          .split('/')
          .join(':');
        const commandHelp = run(binary, [command, '--help']);
        assert.ok(
          [command, command.replaceAll(':', ' ')].some((name) => commandHelp.includes(name)),
          `Missing command help: ${command}`,
        );
      }
    }
    if (pkg.name === '@terra-graph/icons-aws') {
      const iconManifest = JSON.parse(
        readFileSync(join(installed, 'generated/aws-icon-manifest.json'), 'utf8'),
      );
      for (const icon of Object.values(iconManifest.icons)) {
        for (const format of Object.values(icon.formats))
          assert.ok(existsSync(join(installed, format.path)), `Missing icon ${format.path}`);
      }
      // Use the repository's build tool, but resolve the fixture from the isolated consumer.
      writeFileSync(
        join(temporary, 'browser.mjs'),
        "import { AwsIcon } from '@terra-graph/icons-aws/browser'; console.log(AwsIcon.fromTerraformResource('aws_lambda_function'));\n",
      );
      const { build } = await import(resolve(root, 'node_modules/esbuild/lib/main.js'));
      await build({
        entryPoints: [join(temporary, 'browser.mjs')],
        bundle: true,
        platform: 'browser',
        write: false,
      });
    }
  }
  console.log('Packaged consumers passed.');
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

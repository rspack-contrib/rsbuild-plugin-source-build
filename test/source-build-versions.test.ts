import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRsbuild as createRsbuildV2 } from '@rsbuild/core';
import { createRsbuild as createRsbuildV1 } from '@rsbuild/core-1.0';
import { afterEach, expect, test } from '@rstest/core';
import { pluginSourceBuild } from '../src/index.js';

const loadModule = createRequire(import.meta.url);
const fixtureRoot = fileURLToPath(
  new URL('../fixtures/source-build-monorepo', import.meta.url),
);
const temporaryDirectories: string[] = [];
const rsbuildV1Version = (
  loadModule('@rsbuild/core-1.0/package.json') as { version: string }
).version;
const rsbuildV2Version = (
  loadModule('@rsbuild/core/package.json') as { version: string }
).version;

const rsbuildVersions = [
  {
    name: `Rsbuild ${rsbuildV1Version}`,
    createRsbuild: createRsbuildV1,
  },
  {
    name: `Rsbuild ${rsbuildV2Version}`,
    createRsbuild: createRsbuildV2,
  },
];

function linkPackage(
  monorepoRoot: string,
  packageName: string,
  packageRoot: string,
): void {
  const packageLink = path.join(monorepoRoot, 'node_modules', packageName);
  fs.mkdirSync(path.dirname(packageLink), { recursive: true });
  fs.symlinkSync(
    packageRoot,
    packageLink,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
}

function prepareFixture(): string {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'source-build-version-matrix-'),
  );
  temporaryDirectories.push(temporaryRoot);

  const monorepoRoot = path.join(temporaryRoot, 'monorepo');
  fs.cpSync(fixtureRoot, monorepoRoot, { recursive: true });

  for (const packageDirectory of [
    'source-first',
    'output-first',
    'transitive',
    'undeclared',
  ]) {
    linkPackage(
      monorepoRoot,
      `@fixture/${packageDirectory}`,
      path.join(monorepoRoot, 'packages', packageDirectory),
    );
  }

  fs.cpSync(
    path.join(monorepoRoot, 'vendor', 'external'),
    path.join(monorepoRoot, 'node_modules/@fixture/external'),
    { recursive: true },
  );

  return path.join(monorepoRoot, 'app');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

for (const { createRsbuild, name } of rsbuildVersions) {
  test(`${name} builds the fixture through scoped workspace source resolution`, async () => {
    const appRoot = prepareFixture();
    const rsbuild = await createRsbuild({
      cwd: appRoot,
      rsbuildConfig: {
        mode: 'development',
        source: { entry: { index: './src/index.ts' } },
        output: {
          target: 'node',
          distPath: { root: 'dist' },
          filename: { js: '[name].js' },
        },
        plugins: [
          pluginSourceBuild({
            resolvePriority: {
              '@fixture/output-first': 'output',
            },
          }),
        ],
        tools: {
          rspack: {
            output: { library: { type: 'commonjs2' } },
          },
        },
      },
    } as never);

    await rsbuild.build();

    const bundlePath = path.join(appRoot, 'dist/index.js');
    delete loadModule.cache[bundlePath];
    expect(loadModule(bundlePath).default).toEqual([
      'source-first:transitive-source',
      'output-first-dist',
      'undeclared-dist',
      'external-dist',
    ]);
  });
}

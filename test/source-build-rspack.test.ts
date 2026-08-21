import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { type Compiler, rspack, type RspackOptions } from '@rspack/core';
import { afterEach, describe, expect, test } from '@rstest/core';
import { Project } from '../src/project.js';
import { SourceBuildResolverPlugin } from '../src/source-build/rspack-plugin.js';
import {
  createSourceBuildPackages,
  SourceBuildPackage,
  type SourceBuildPackages,
} from '../src/source-build/resolve.js';

const temporaryDirectories: string[] = [];
const loadModule = createRequire(import.meta.url);

type TestAlias = Record<string, string | false | Array<string | false>>;

interface TestPackage {
  name: string;
  packageJson: Record<string, unknown>;
  root: string;
  sourceBuildPackage: SourceBuildPackage;
}

async function runCompiler(
  compiler: NonNullable<ReturnType<typeof rspack>>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    compiler.run((error, stats) => {
      compiler.close(() => {
        if (error) {
          reject(error);
          return;
        }
        if (!stats || stats.hasErrors()) {
          reject(
            new Error(
              stats?.toString({ all: false, errors: true }) ??
                'Rspack compilation failed',
            ),
          );
          return;
        }
        resolve();
      });
    });
  });
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [file, content] of Object.entries(files)) {
    const filePath = path.join(root, file);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

function createTestPackage(
  fixtureRoot: string,
  name: string,
  packageJson: Record<string, unknown>,
  files: Record<string, string>,
): TestPackage {
  const root = path.join(fixtureRoot, 'workspace', name.replace('/', '__'));
  fs.mkdirSync(root, { recursive: true });
  const completePackageJson = {
    name,
    ...packageJson,
  };
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(completePackageJson),
  );
  writeFiles(root, files);

  return {
    name,
    packageJson: completePackageJson,
    root,
    sourceBuildPackage: {
      resolvePriority: 'source',
      root,
    },
  };
}

function createPackages(...packages: TestPackage[]): SourceBuildPackages {
  return new Map(packages.map((item) => [item.name, item.sourceBuildPackage]));
}

function linkPackage(appRoot: string, testPackage: TestPackage): void {
  const packageLink = path.join(appRoot, 'node_modules', testPackage.name);
  fs.mkdirSync(path.dirname(packageLink), { recursive: true });
  fs.symlinkSync(
    testPackage.root,
    packageLink,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
}

async function compileRequests(
  appRoot: string,
  packages: SourceBuildPackages,
  requests: string[],
  options?: {
    alias?: TestAlias;
    byDependencyAlias?: TestAlias;
    extensions?: string[];
    externals?: RspackOptions['externals'];
    plugins?: Array<(compiler: Compiler) => void>;
    ruleAlias?: TestAlias;
    tsConfig?: {
      configFile: string;
      references: string[];
    };
  },
): Promise<unknown[]> {
  const outputPath = path.join(appRoot, 'dist');
  fs.writeFileSync(
    path.join(appRoot, 'entry.js'),
    `module.exports = [${requests
      .map((request) => `require(${JSON.stringify(request)})`)
      .join(',')}];`,
  );

  const compiler = rspack({
    context: appRoot,
    entry: './entry.js',
    externals: options?.externals,
    mode: 'development',
    target: 'node',
    output: {
      filename: 'bundle.js',
      library: { type: 'commonjs2' },
      path: outputPath,
    },
    module: options?.ruleAlias
      ? {
          rules: [
            {
              test: /entry\.js$/,
              resolve: { alias: options.ruleAlias },
            },
          ],
        }
      : undefined,
    plugins: [
      new SourceBuildResolverPlugin(packages, 'source'),
      ...(options?.plugins ?? []),
    ],
    resolve: {
      alias: options?.alias,
      byDependency: options?.byDependencyAlias
        ? { commonjs: { alias: options.byDependencyAlias } }
        : undefined,
      extensions: options?.extensions ?? ['.js', '.ts'],
      tsConfig: options?.tsConfig,
    },
  });

  await runCompiler(compiler);

  const bundlePath = path.join(outputPath, 'bundle.js');
  delete loadModule.cache[bundlePath];
  return loadModule(bundlePath) as unknown[];
}

function createChildCompilerPlugin(packageName: string, mockPath: string) {
  return (parentCompiler: Compiler) => {
    parentCompiler.hooks.make.tapAsync(
      'TestChildCompiler',
      (compilation, callback) => {
        const childCompiler = compilation.createChildCompiler(
          'TestChildCompiler',
          { filename: 'child.js' },
          [
            new (parentCompiler.rspack ?? parentCompiler.webpack).EntryPlugin(
              parentCompiler.context,
              './child-entry.js',
              'child',
            ),
          ],
        );
        childCompiler.options.resolve.alias = {
          ...childCompiler.options.resolve.alias,
          [packageName]: mockPath,
        };
        childCompiler.runAsChild((error) => callback(error));
      },
    );
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe('scoped Rspack source resolution', () => {
  test('falls back to output when a source-priority entry is missing', async () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'source-build-missing-source-'),
    );
    temporaryDirectories.push(fixtureRoot);
    const appRoot = path.join(fixtureRoot, 'app');
    fs.mkdirSync(appRoot, { recursive: true });

    const selectedPackage = createTestPackage(
      fixtureRoot,
      '@test/missing-source',
      {
        source: './src/missing.js',
        main: './dist/index.js',
      },
      { 'dist/index.js': `module.exports = 'output-fallback';` },
    );
    linkPackage(appRoot, selectedPackage);

    await expect(
      compileRequests(appRoot, createPackages(selectedPackage), [
        selectedPackage.name,
      ]),
    ).resolves.toEqual(['output-fallback']);
  });

  test('falls back to source when an output-priority package has no output entry', async () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'source-build-missing-output-'),
    );
    temporaryDirectories.push(fixtureRoot);
    const appRoot = path.join(fixtureRoot, 'app');
    fs.mkdirSync(appRoot, { recursive: true });

    const selectedPackage = createTestPackage(
      fixtureRoot,
      '@test/missing-output',
      { source: './src/index.js' },
      { 'src/index.js': `module.exports = 'source-fallback';` },
    );
    linkPackage(appRoot, selectedPackage);
    const project = new Project(selectedPackage.name, selectedPackage.root);
    project.metaData = selectedPackage.packageJson;
    const outputFirstPackages = createSourceBuildPackages([project], {
      resolvePriority: 'output',
    });

    await expect(
      compileRequests(appRoot, outputFirstPackages, [selectedPackage.name]),
    ).resolves.toEqual(['source-fallback']);
  });

  test('falls back to an aliased source-only package with output priority', async () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'source-build-aliased-output-priority-'),
    );
    temporaryDirectories.push(fixtureRoot);
    const appRoot = path.join(fixtureRoot, 'app');
    fs.mkdirSync(appRoot, { recursive: true });

    const selectedPackage = createTestPackage(
      fixtureRoot,
      '@test/aliased-source-only',
      { source: './src/index.js' },
      { 'src/index.js': `module.exports = 'aliased-source-fallback';` },
    );
    selectedPackage.sourceBuildPackage.resolvePriority = 'output';
    linkPackage(appRoot, selectedPackage);

    await expect(
      compileRequests(
        appRoot,
        createPackages(selectedPackage),
        ['@test/public-output-entry'],
        {
          alias: {
            '@test/public-output-entry': selectedPackage.name,
          },
        },
      ),
    ).resolves.toEqual(['aliased-source-fallback']);
  });

  test('preserves target and dependency conditions inside source exports', async () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'source-build-conditions-'),
    );
    temporaryDirectories.push(fixtureRoot);
    const appRoot = path.join(fixtureRoot, 'app');
    const outputPath = path.join(appRoot, 'dist');
    fs.mkdirSync(appRoot, { recursive: true });

    const selectedPackage = createTestPackage(
      fixtureRoot,
      '@test/conditional-source',
      {
        exports: {
          '.': {
            browser: {
              source: './src/browser.js',
              default: './dist/browser.js',
            },
            node: {
              import: {
                source: './src/import.mjs',
                default: './dist/import.mjs',
              },
              require: {
                source: './src/require.js',
                default: './dist/require.js',
              },
            },
          },
        },
      },
      {
        'src/browser.js': `module.exports = 'browser-source';`,
        'dist/browser.js': `module.exports = 'browser-dist';`,
        'src/import.mjs': `export default 'import-source';`,
        'dist/import.mjs': `export default 'import-dist';`,
        'src/require.js': `module.exports = 'require-source';`,
        'dist/require.js': `module.exports = 'require-dist';`,
      },
    );
    linkPackage(appRoot, selectedPackage);
    fs.writeFileSync(
      path.join(appRoot, 'entry.js'),
      `import imported from '${selectedPackage.name}';
       export default [imported, require('${selectedPackage.name}')];`,
    );

    const compiler = rspack({
      context: appRoot,
      entry: './entry.js',
      mode: 'development',
      target: 'node',
      output: {
        filename: 'bundle.js',
        library: { type: 'commonjs2' },
        path: outputPath,
      },
      plugins: [
        new SourceBuildResolverPlugin(
          createPackages(selectedPackage),
          'source',
        ),
      ],
    });

    await runCompiler(compiler);

    const bundlePath = path.join(outputPath, 'bundle.js');
    delete loadModule.cache[bundlePath];
    expect(loadModule(bundlePath).default).toEqual([
      'import-source',
      'require-source',
    ]);
  });

  test('uses selected workspace packages, not tsconfig references, as the source-build boundary', async () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'source-build-boundary-'),
    );
    temporaryDirectories.push(fixtureRoot);
    const appRoot = path.join(fixtureRoot, 'app');
    fs.mkdirSync(appRoot, { recursive: true });

    const selectedPackage = createTestPackage(
      fixtureRoot,
      '@test/configured',
      {
        exports: {
          '.': {
            source: './src/index.js',
            require: './dist/index.js',
          },
        },
      },
      {
        'src/index.js': `module.exports = 'configured-source';`,
        'dist/index.js': `module.exports = 'configured-dist';`,
      },
    );
    const referencedPackage = createTestPackage(
      fixtureRoot,
      '@test/referenced-only',
      {
        exports: {
          '.': {
            source: './src/index.js',
            require: './dist/index.js',
          },
        },
      },
      {
        'src/index.js': `module.exports = 'referenced-source';`,
        'dist/index.js': `module.exports = 'referenced-dist';`,
        'tsconfig.json': JSON.stringify({
          compilerOptions: { composite: true },
        }),
      },
    );
    const appTsconfigPath = path.join(appRoot, 'tsconfig.json');
    fs.writeFileSync(appTsconfigPath, JSON.stringify({ compilerOptions: {} }));
    linkPackage(appRoot, selectedPackage);
    linkPackage(appRoot, referencedPackage);

    await expect(
      compileRequests(
        appRoot,
        createPackages(selectedPackage),
        [selectedPackage.name, referencedPackage.name],
        {
          tsConfig: {
            configFile: appTsconfigPath,
            references: [path.join(referencedPackage.root, 'tsconfig.json')],
          },
        },
      ),
    ).resolves.toEqual(['configured-source', 'referenced-dist']);
  });

  test('does not source-build a node_modules package that only shares a selected package name', async () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'source-build-package-root-'),
    );
    temporaryDirectories.push(fixtureRoot);
    const appRoot = path.join(fixtureRoot, 'app');
    fs.mkdirSync(appRoot, { recursive: true });

    const selectedPackage = createTestPackage(
      fixtureRoot,
      '@test/shared-name',
      {
        source: './src/index.js',
        main: './dist/index.js',
      },
      {
        'src/index.js': `module.exports = 'workspace-source';`,
        'dist/index.js': `module.exports = 'workspace-dist';`,
      },
    );
    writeFiles(path.join(appRoot, 'node_modules', selectedPackage.name), {
      'package.json': JSON.stringify({
        name: selectedPackage.name,
        source: './src/index.js',
        main: './dist/index.js',
      }),
      'src/index.js': `module.exports = 'node-modules-source';`,
      'dist/index.js': `module.exports = 'node-modules-dist';`,
    });

    await expect(
      compileRequests(appRoot, createPackages(selectedPackage), [
        selectedPackage.name,
      ]),
    ).resolves.toEqual(['node-modules-dist']);
  });

  test('builds only selected workspace packages from source', async () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'source-build-scoped-'),
    );
    temporaryDirectories.push(fixtureRoot);
    const appRoot = path.join(fixtureRoot, 'app');
    fs.mkdirSync(appRoot, { recursive: true });

    const selectedPackage = createTestPackage(
      fixtureRoot,
      '@test/selected',
      {
        source: './src/index.ts',
        main: './dist/index.js',
        exports: {
          '.': {
            source: './src/index.ts',
            require: './dist/index.js',
          },
          './*.css': {
            source: './src/*.scss',
            require: './dist/*.css',
          },
        },
      },
      {
        'src/index.ts': `module.exports = 'selected-source';`,
        'src/theme.scss': `module.exports = 'selected-style';`,
        'dist/index.js': `module.exports = 'selected-dist';`,
        'dist/theme.css': `module.exports = 'selected-dist-style';`,
      },
    );
    const externalPackage = createTestPackage(
      fixtureRoot,
      '@test/external',
      {
        exports: {
          '.': {
            source: './src/index.js',
            require: './dist/index.js',
          },
        },
      },
      {
        'src/index.js': `module.exports = 'external-source';`,
        'dist/index.js': `module.exports = 'external-dist';`,
      },
    );
    linkPackage(appRoot, selectedPackage);
    linkPackage(appRoot, externalPackage);

    await expect(
      compileRequests(appRoot, createPackages(selectedPackage), [
        selectedPackage.name,
        `${selectedPackage.name}/theme.css?raw`,
      ]),
    ).resolves.toEqual(['selected-source', 'selected-style']);
    await expect(
      compileRequests(appRoot, createPackages(), [externalPackage.name]),
    ).resolves.toEqual(['external-dist']);
  });

  test('keeps explicit aliases ahead of source rewrites and follows alias fallbacks', async () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'source-build-alias-'),
    );
    temporaryDirectories.push(fixtureRoot);
    const appRoot = path.join(fixtureRoot, 'app');
    fs.mkdirSync(appRoot, { recursive: true });
    const selectedPackage = createTestPackage(
      fixtureRoot,
      '@test/source-target',
      { source: './src/index.js' },
      { 'src/index.js': `module.exports = 'workspace-source';` },
    );
    const mockPath = path.join(appRoot, 'mock.js');
    fs.writeFileSync(mockPath, `module.exports = 'explicit-alias';`);
    linkPackage(appRoot, selectedPackage);

    await expect(
      compileRequests(
        appRoot,
        createPackages(selectedPackage),
        [selectedPackage.name],
        {
          alias: { [selectedPackage.name]: mockPath },
        },
      ),
    ).resolves.toEqual(['explicit-alias']);

    await expect(
      compileRequests(
        appRoot,
        createPackages(selectedPackage),
        [selectedPackage.name],
        {
          ruleAlias: { [selectedPackage.name]: mockPath },
        },
      ),
    ).resolves.toEqual(['explicit-alias']);

    await expect(
      compileRequests(
        appRoot,
        createPackages(selectedPackage),
        [selectedPackage.name],
        {
          byDependencyAlias: { [selectedPackage.name]: mockPath },
        },
      ),
    ).resolves.toEqual(['explicit-alias']);

    await expect(
      compileRequests(
        appRoot,
        createPackages(selectedPackage),
        ['@test/public-entry'],
        {
          alias: {
            '@test/public-entry': [
              '@test/missing-entry',
              '@test/intermediate-entry',
            ],
            '@test/intermediate-entry': selectedPackage.name,
          },
        },
      ),
    ).resolves.toEqual(['workspace-source']);
  });

  test('keeps user externals ahead of scoped source resolution', async () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'source-build-externals-'),
    );
    temporaryDirectories.push(fixtureRoot);
    const appRoot = path.join(fixtureRoot, 'app');
    fs.mkdirSync(appRoot, { recursive: true });

    const externalizedPackage = createTestPackage(
      fixtureRoot,
      '@test/externalized-workspace',
      {
        source: './src/index.js',
        main: './dist/index.js',
      },
      {
        'src/index.js': `module.exports = 'externalized-source';`,
        'dist/index.js': `module.exports = 'externalized-output';`,
      },
    );
    const sourcePackage = createTestPackage(
      fixtureRoot,
      '@test/non-externalized-workspace',
      {
        source: './src/index.js',
        main: './dist/index.js',
      },
      {
        'src/index.js': `module.exports = 'selected-source';`,
        'dist/index.js': `module.exports = 'selected-output';`,
      },
    );
    linkPackage(appRoot, externalizedPackage);
    linkPackage(appRoot, sourcePackage);

    await expect(
      compileRequests(
        appRoot,
        createPackages(externalizedPackage, sourcePackage),
        [externalizedPackage.name, sourcePackage.name],
        {
          externals: {
            [externalizedPackage.name]: `commonjs ${externalizedPackage.name}`,
          },
        },
      ),
    ).resolves.toEqual(['externalized-output', 'selected-source']);
  });

  test('rewrites source requests made through loader resolvers', async () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'source-build-loader-'),
    );
    temporaryDirectories.push(fixtureRoot);
    const appRoot = path.join(fixtureRoot, 'app');
    const outputPath = path.join(appRoot, 'dist');
    fs.mkdirSync(appRoot, { recursive: true });
    const selectedPackage = createTestPackage(
      fixtureRoot,
      '@test/loader-style',
      {
        exports: {
          './*.css': {
            source: './src/*.scss',
            require: './dist/*.css',
          },
        },
      },
      { 'src/theme.scss': '' },
    );
    const loaderPath = path.join(appRoot, 'resolve-loader.cjs');
    linkPackage(appRoot, selectedPackage);
    fs.writeFileSync(
      loaderPath,
      `module.exports = function () {
        const callback = this.async();
        this.getResolve({ extensions: ['.scss'] })(
          this.context,
          '@test/loader-public',
          (error, result) => callback(error, 'module.exports = ' + JSON.stringify(result)),
        );
      };`,
    );
    fs.writeFileSync(
      path.join(appRoot, 'entry.js'),
      `module.exports = require('./style.fixture');`,
    );
    fs.writeFileSync(path.join(appRoot, 'style.fixture'), '');

    const compiler = rspack({
      context: appRoot,
      entry: './entry.js',
      mode: 'development',
      target: 'node',
      output: {
        filename: 'bundle.js',
        library: { type: 'commonjs2' },
        path: outputPath,
      },
      module: {
        rules: [{ test: /\.fixture$/, use: loaderPath }],
      },
      plugins: [
        new SourceBuildResolverPlugin(
          createPackages(selectedPackage),
          'source',
        ),
      ],
      resolve: {
        alias: {
          '@test/loader-public': `${selectedPackage.name}/theme.css`,
        },
      },
    });

    await runCompiler(compiler);

    const bundlePath = path.join(outputPath, 'bundle.js');
    delete loadModule.cache[bundlePath];
    expect(loadModule(bundlePath)).toBe(
      path.join(selectedPackage.root, 'src/theme.scss'),
    );
  });

  test('applies scoped resolution and child-specific aliases in child compilers', async () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'source-build-child-'),
    );
    temporaryDirectories.push(fixtureRoot);
    const appRoot = path.join(fixtureRoot, 'app');
    const outputPath = path.join(appRoot, 'dist');
    fs.mkdirSync(appRoot, { recursive: true });
    const mockedPackage = createTestPackage(
      fixtureRoot,
      '@test/child-mocked',
      { source: './src/index.js' },
      { 'src/index.js': `module.exports = 'unexpected-source';` },
    );
    const selectedPackage = createTestPackage(
      fixtureRoot,
      '@test/child-source',
      { source: './src/index.js' },
      { 'src/index.js': `module.exports = 'child-workspace-source';` },
    );
    const mockPath = path.join(appRoot, 'child-mock.js');
    linkPackage(appRoot, selectedPackage);
    fs.writeFileSync(mockPath, `module.exports = 'child-explicit-alias';`);
    fs.writeFileSync(
      path.join(appRoot, 'entry.js'),
      `module.exports = 'parent';`,
    );
    fs.writeFileSync(
      path.join(appRoot, 'child-entry.js'),
      `module.exports = [require('${mockedPackage.name}'), require('${selectedPackage.name}')];`,
    );

    const compiler = rspack({
      context: appRoot,
      entry: './entry.js',
      mode: 'development',
      target: 'node',
      output: { filename: 'bundle.js', path: outputPath },
      plugins: [
        new SourceBuildResolverPlugin(
          createPackages(mockedPackage, selectedPackage),
          'source',
        ),
        createChildCompilerPlugin(mockedPackage.name, mockPath),
      ],
      resolve: { extensions: ['.js'] },
    });

    await runCompiler(compiler);

    const childBundle = fs.readFileSync(
      path.join(outputPath, 'child.js'),
      'utf8',
    );
    expect(childBundle).toContain('child-explicit-alias');
    expect(childBundle).toContain('child-workspace-source');
    expect(childBundle).not.toContain('unexpected-source');
  });
});

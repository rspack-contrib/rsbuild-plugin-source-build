import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createRsbuild, type RsbuildPlugin } from '@rsbuild/core';
import { afterEach, expect, test } from '@rstest/core';
import {
  type ExtraMonorepoStrategies,
  type MonorepoAnalyzer,
  pluginSourceBuild,
  Project,
} from '../src/index.js';

const loadModule = createRequire(import.meta.url);
const temporaryDirectories: string[] = [];

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), 10_000);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [file, content] of Object.entries(files)) {
    const filePath = path.join(root, file);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

async function createProject(
  root: string,
  name: string,
  packageJson: Record<string, unknown>,
  files: Record<string, string>,
): Promise<Project> {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name, ...packageJson }),
  );
  writeFiles(root, files);

  const project = new Project(name, root);
  await project.init();
  return project;
}

function linkPackage(appRoot: string, project: Project): void {
  const packageLink = path.join(appRoot, 'node_modules', project.name);
  fs.mkdirSync(path.dirname(packageLink), { recursive: true });
  fs.symlinkSync(
    project.dir,
    packageLink,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('uses adapter projects and package dependencies as the source-build boundary', async () => {
  const monorepoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'source-build-adapter-'),
  );
  temporaryDirectories.push(monorepoRoot);

  const appRoot = path.join(monorepoRoot, 'app');
  const selected = await createProject(
    path.join(monorepoRoot, 'selected'),
    '@test/selected',
    {
      exports: {
        '.': {
          source: './src/index.js',
          require: './dist/index.js',
        },
      },
    },
    {
      'src/index.js': `module.exports = 'selected-source';`,
      'dist/index.js': `module.exports = 'selected-dist';`,
      'tsconfig.json': JSON.stringify({ compilerOptions: { composite: true } }),
    },
  );
  const workspaceOnly = await createProject(
    path.join(monorepoRoot, 'workspace-only'),
    '@test/workspace-only',
    {
      exports: {
        '.': {
          source: './src/index.js',
          require: './dist/index.js',
        },
      },
    },
    {
      'src/index.js': `module.exports = 'workspace-source';`,
      'dist/index.js': `module.exports = 'workspace-dist';`,
    },
  );
  const conditional = await createProject(
    path.join(monorepoRoot, 'conditional'),
    '@test/conditional',
    {
      exports: {
        '.': {
          node: {
            require: {
              source: './src/index.js',
              default: './dist/index.js',
            },
          },
        },
      },
    },
    {
      'src/index.js': `module.exports = 'conditional-source';`,
      'dist/index.js': `module.exports = 'conditional-dist';`,
    },
  );
  const referencedOnly = await createProject(
    path.join(monorepoRoot, 'referenced-only'),
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
      'tsconfig.json': JSON.stringify({ compilerOptions: { composite: true } }),
    },
  );
  const app = await createProject(
    appRoot,
    '@test/app',
    {
      private: true,
      dependencies: {
        [selected.name]: 'workspace:*',
        [conditional.name]: 'workspace:*',
        '@test/external': '1.0.0',
        '@test/external-main': '1.0.0',
      },
    },
    {
      'src/index.js': `module.exports = [
        require('${selected.name}'),
        require('${conditional.name}'),
        require('${workspaceOnly.name}'),
        require('${referencedOnly.name}'),
        require('@test/external'),
        require('@test/external-main'),
      ];`,
      'tsconfig.json': JSON.stringify({
        compilerOptions: {},
        references: [{ path: '../referenced-only/tsconfig.json' }],
      }),
    },
  );

  for (const project of [
    selected,
    conditional,
    workspaceOnly,
    referencedOnly,
  ]) {
    linkPackage(appRoot, project);
  }
  writeFiles(path.join(appRoot, 'node_modules/@test/external'), {
    'package.json': JSON.stringify({
      name: '@test/external',
      exports: {
        '.': {
          source: './src/index.js',
          require: './dist/index.js',
        },
      },
    }),
    'src/index.js': `module.exports = 'external-source';`,
    'dist/index.js': `module.exports = 'external-dist';`,
  });
  writeFiles(path.join(appRoot, 'node_modules/@test/external-main'), {
    'package.json': JSON.stringify({
      name: '@test/external-main',
      source: './src/index.js',
      main: './dist/index.js',
    }),
    'src/index.js': `module.exports = 'external-main-source';`,
    'dist/index.js': `module.exports = 'external-main-dist';`,
  });

  const projects = [app, selected, conditional, workspaceOnly, referencedOnly];
  const adapter: MonorepoAnalyzer = {
    check: (root) => root === monorepoRoot,
    getProjects: async () => projects,
  };
  const extraMonorepoStrategies: ExtraMonorepoStrategies = {
    test: adapter,
  };
  const rsbuild = await createRsbuild({
    cwd: appRoot,
    rsbuildConfig: {
      mode: 'development',
      source: { entry: { index: './src/index.js' } },
      output: {
        target: 'node',
        distPath: { root: 'dist' },
        filename: { js: '[name].js' },
      },
      plugins: [
        pluginSourceBuild({
          projectName: app.name,
          extraMonorepoStrategies,
        }),
      ],
      tools: {
        rspack: {
          output: { library: { type: 'commonjs2' } },
        },
      },
    },
  });

  await rsbuild.build();

  const bundlePath = path.join(appRoot, 'dist/index.js');
  delete loadModule.cache[bundlePath];
  expect(loadModule(bundlePath)).toEqual([
    'selected-source',
    'conditional-source',
    'workspace-dist',
    'referenced-dist',
    'external-dist',
    'external-main-dist',
  ]);
});

test('tracks resolved workspace source without adding source.include', async () => {
  const monorepoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'source-build-watch-'),
  );
  temporaryDirectories.push(monorepoRoot);

  const appRoot = path.join(monorepoRoot, 'app');
  const selected = await createProject(
    path.join(monorepoRoot, 'selected'),
    '@test/watched-source',
    {
      source: './src/before.js',
      main: './dist/index.js',
    },
    {
      'src/before.js': `module.exports = 'source-before';`,
      'src/after.js': `module.exports = 'source-after';`,
      'dist/index.js': `module.exports = 'dist';`,
    },
  );
  const app = await createProject(
    appRoot,
    '@test/watch-app',
    {
      private: true,
      dependencies: { [selected.name]: 'workspace:*' },
    },
    {
      'src/index.js': `module.exports = require('${selected.name}');`,
      'tsconfig.json': JSON.stringify({ compilerOptions: {} }),
    },
  );
  linkPackage(appRoot, selected);

  let resolveFirstBuild!: () => void;
  let resolveSecondBuild!: () => void;
  let resolveThirdBuild!: () => void;
  const firstBuild = new Promise<void>((resolve) => {
    resolveFirstBuild = resolve;
  });
  const secondBuild = new Promise<void>((resolve) => {
    resolveSecondBuild = resolve;
  });
  const thirdBuild = new Promise<void>((resolve) => {
    resolveThirdBuild = resolve;
  });
  const bundlePath = path.join(appRoot, 'dist/index.js');
  const expectedBuilds = new Map<string, () => void>([
    ['source-before', resolveFirstBuild],
    ['source-after', resolveSecondBuild],
    ['source-after-updated', resolveThirdBuild],
  ]);
  const observeBuilds: RsbuildPlugin = {
    name: 'test:observe-source-builds',
    setup(api) {
      api.onAfterBuild(() => {
        try {
          delete loadModule.cache[bundlePath];
          const result = loadModule(bundlePath) as string;
          expectedBuilds.get(result)?.();
        } catch {
          // The assertion below reports a useful error if the build never emits.
        }
      });
    },
  };
  const adapter: MonorepoAnalyzer = {
    check: (root) => root === monorepoRoot,
    getProjects: async () => [app, selected],
  };
  const rsbuild = await createRsbuild({
    cwd: appRoot,
    rsbuildConfig: {
      mode: 'development',
      source: { entry: { index: './src/index.js' } },
      output: {
        target: 'node',
        distPath: { root: 'dist' },
        filename: { js: '[name].js' },
      },
      plugins: [
        pluginSourceBuild({
          projectName: app.name,
          extraMonorepoStrategies: { test: adapter },
        }),
        observeBuilds,
      ],
      tools: {
        rspack: {
          output: { library: { type: 'commonjs2' } },
        },
      },
    },
  });

  const buildResult = await rsbuild.build({ watch: true });
  try {
    await withTimeout(firstBuild, 'Timed out waiting for the initial build.');
    expect(rsbuild.getNormalizedConfig().source.include).toBeUndefined();
    delete loadModule.cache[bundlePath];
    expect(loadModule(bundlePath)).toBe('source-before');

    fs.writeFileSync(
      path.join(selected.dir, 'package.json'),
      JSON.stringify({
        name: selected.name,
        source: './src/after.js',
        main: './dist/index.js',
      }),
    );
    await withTimeout(
      secondBuild,
      'Timed out waiting for the package metadata rebuild.',
    );
    delete loadModule.cache[bundlePath];
    expect(loadModule(bundlePath)).toBe('source-after');

    fs.writeFileSync(
      path.join(selected.dir, 'src/after.js'),
      `module.exports = 'source-after-updated';`,
    );
    await withTimeout(
      thirdBuild,
      'Timed out waiting for the workspace source rebuild.',
    );
    delete loadModule.cache[bundlePath];
    expect(loadModule(bundlePath)).toBe('source-after-updated');
  } finally {
    await buildResult.close();
  }
});

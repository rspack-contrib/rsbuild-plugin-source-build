import path from 'node:path';
import type { NormalModuleFactory } from '@rspack/core';
import { describe, expect, rs, test } from '@rstest/core';
import { pluginSourceBuild } from '../src/plugin.js';
import { Project } from '../src/project.js';
import { DependencyResolverTracker } from '../src/source-build/dependency-resolver-tracker.js';
import { getNormalResolver } from '../src/source-build/rspack-plugin.js';
import {
  createSourceBuildPackages,
  getSourceBuildPackage,
  type SourceBuildPackage,
} from '../src/source-build/resolve.js';

const PACKAGE_NAME = '@test/source';
const PACKAGE_ROOT = path.resolve('/workspace/source');

type BundlerChainCallback = (chain: unknown, utils: unknown) => unknown;

describe('source-build package boundary', () => {
  const sourceBuildPackage: SourceBuildPackage = {
    resolvePriority: 'source',
    root: PACKAGE_ROOT,
  };
  const packages = new Map([[PACKAGE_NAME, sourceBuildPackage]]);

  test('matches configured package roots and subpaths only', () => {
    expect(getSourceBuildPackage(PACKAGE_NAME, packages)).toBe(
      sourceBuildPackage,
    );
    expect(
      getSourceBuildPackage(`${PACKAGE_NAME}/theme.css?raw`, packages),
    ).toBe(sourceBuildPackage);
    expect(getSourceBuildPackage('@test/external', packages)).toBeUndefined();
    expect(getSourceBuildPackage('./local', packages)).toBeUndefined();
    expect(
      getSourceBuildPackage('/workspace/source/src/index.ts', packages),
    ).toBeUndefined();
  });

  test('retains the selected project root and global resolve priority', () => {
    const project = new Project(PACKAGE_NAME, PACKAGE_ROOT);

    expect(
      createSourceBuildPackages([project], { resolvePriority: 'output' }),
    ).toEqual(
      new Map([
        [
          PACKAGE_NAME,
          {
            resolvePriority: 'output',
            root: PACKAGE_ROOT,
          },
        ],
      ]),
    );
  });

  test('supports per-package resolve priority overrides', () => {
    const sourceProject = new Project(PACKAGE_NAME, PACKAGE_ROOT);
    const outputProject = new Project(
      '@test/output',
      path.resolve('/workspace/output'),
    );

    expect(
      createSourceBuildPackages([sourceProject, outputProject], {
        resolvePriority: {
          [outputProject.name]: 'output',
        },
      }),
    ).toEqual(
      new Map([
        [
          PACKAGE_NAME,
          {
            resolvePriority: 'source',
            root: PACKAGE_ROOT,
          },
        ],
        [
          outputProject.name,
          {
            resolvePriority: 'output',
            root: outputProject.dir,
          },
        ],
      ]),
    );
  });
});

describe('plugin configuration', () => {
  test('rejects invalid resolve priority values at plugin creation', () => {
    expect(() =>
      pluginSourceBuild({
        resolvePriority: { [PACKAGE_NAME]: 'Source' } as never,
      }),
    ).toThrow('Invalid resolvePriority for "@test/source"');

    expect(() =>
      pluginSourceBuild({ resolvePriority: 'invalid' as never }),
    ).toThrow('Invalid resolvePriority for "resolvePriority"');
  });

  test('rejects per-package resolve priority outside Rspack', () => {
    const callbacks: BundlerChainCallback[] = [];
    const plugin = pluginSourceBuild({
      resolvePriority: { [PACKAGE_NAME]: 'source' },
    });

    plugin.setup({
      context: {
        bundlerType: 'webpack',
        rootPath: PACKAGE_ROOT,
      },
      modifyBundlerChain: (callback: BundlerChainCallback) => {
        callbacks.push(callback);
      },
    } as never);

    expect(() => callbacks[0]({}, {})).toThrow(
      'Per-package resolvePriority is only supported with Rspack.',
    );
  });
});

describe('getNormalResolver', () => {
  const resolver = {
    resolve: rs.fn(),
  } as unknown as ReturnType<NormalModuleFactory['getResolver']>;

  test('uses the normal module factory resolver when available', () => {
    const nativeGet = rs.fn(() => resolver);
    const fallbackGet = rs.fn(() => resolver);

    expect(
      getNormalResolver(
        { getResolver: nativeGet } as Pick<NormalModuleFactory, 'getResolver'>,
        { resolverFactory: { get: fallbackGet } },
      ),
    ).toBe(resolver);
    expect(nativeGet).toHaveBeenCalledWith('normal', { alias: false });
    expect(fallbackGet).not.toHaveBeenCalled();
  });

  test('falls back to the compilation resolver factory', () => {
    const fallbackGet = rs.fn(() => resolver);

    expect(
      getNormalResolver({} as Pick<NormalModuleFactory, 'getResolver'>, {
        resolverFactory: { get: fallbackGet },
      }),
    ).toBe(resolver);
    expect(fallbackGet).toHaveBeenCalledWith('normal', { alias: false });
  });
});

describe('DependencyResolverTracker', () => {
  test('serializes concurrent dependency resolvers with the same request key', () => {
    const tracker = new DependencyResolverTracker();
    const resumed: string[] = [];
    const baseData = {
      context: '/workspace/app',
      contextInfo: { issuer: '/workspace/app/src/index.js' },
      request: PACKAGE_NAME,
    };
    const esmData = { ...baseData, dependencyType: 'esm' };
    const commonJsData = { ...baseData, dependencyType: 'commonjs' };

    tracker.add(esmData, () => resumed.push('esm'));
    tracker.add(commonJsData, () => resumed.push('commonjs'));

    expect(resumed).toEqual(['esm']);
    expect(
      tracker.get(
        baseData.context,
        baseData.request,
        baseData.contextInfo.issuer,
      ),
    ).toBe(esmData);

    tracker.release(
      baseData.context,
      baseData.request,
      baseData.contextInfo.issuer,
    );

    expect(resumed).toEqual(['esm', 'commonjs']);
    expect(
      tracker.get(
        baseData.context,
        baseData.request,
        baseData.contextInfo.issuer,
      ),
    ).toBe(commonJsData);
  });
});

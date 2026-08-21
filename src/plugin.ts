import fs from 'node:fs';
import path from 'node:path';
import type { RsbuildPlugin } from '@rsbuild/core';
import json5 from 'json5';
import {
  type ExtraMonorepoStrategies,
  filterByField,
  getDependentProjects,
} from './project-utils/index.js';
import type { Project } from './project.js';
import {
  createSourceBuildPackages,
  type ResolvePriority,
} from './source-build/resolve.js';
import { SourceBuildResolverPlugin } from './source-build/rspack-plugin.js';
import type { TsConfig } from './types/index.js';

export const PLUGIN_SOURCE_BUILD_NAME = 'rsbuild:source-build';

const PACKAGE_RESOLVE_PRIORITIES = new Set(['source', 'output']);

function validateResolvePriority(resolvePriority: unknown): void {
  let entries: [string, unknown][];
  if (typeof resolvePriority === 'string') {
    entries = [['resolvePriority', resolvePriority]];
  } else if (
    resolvePriority &&
    typeof resolvePriority === 'object' &&
    !Array.isArray(resolvePriority)
  ) {
    entries = Object.entries(resolvePriority);
  } else {
    throw new Error(
      `[${PLUGIN_SOURCE_BUILD_NAME}] resolvePriority must be "source", "output", or a package-name map.`,
    );
  }

  for (const [packageName, priority] of entries) {
    if (!PACKAGE_RESOLVE_PRIORITIES.has(priority as string)) {
      throw new Error(
        `[${PLUGIN_SOURCE_BUILD_NAME}] Invalid resolvePriority for "${packageName}": expected "source" or "output", received ${JSON.stringify(priority)}.`,
      );
    }
  }
}

export interface PluginSourceBuildOptions {
  /**
   * Used to configure the resolve field of the source code files.
   * @default 'source'
   */
  sourceField?: string;
  /**
   * Whether to read source code or output code first. Use a package-name map
   * to override the priority for individual selected workspace packages.
   * @default 'source'
   */
  resolvePriority?: ResolvePriority;
  /**
   * The package name of the project that consumes workspace dependencies.
   * Defaults to the package found at the Rsbuild project root.
   */
  projectName?: string;
  /**
   * Additional adapters for discovering projects in custom monorepo formats.
   * The plugin uses the adapter result as the workspace project boundary, then
   * recursively selects dependencies of the current project from that result.
   */
  extraMonorepoStrategies?: ExtraMonorepoStrategies;
}

export function pluginSourceBuild(
  options?: PluginSourceBuildOptions,
): RsbuildPlugin {
  const {
    projectName,
    sourceField = 'source',
    resolvePriority = 'source',
    extraMonorepoStrategies,
  } = options ?? {};
  validateResolvePriority(resolvePriority);

  return {
    name: PLUGIN_SOURCE_BUILD_NAME,

    setup(api) {
      const projectRootPath = api.context.rootPath;

      let projectsPromise: Promise<Project[]> | undefined;
      const getProjects = () => {
        projectsPromise ||= getDependentProjects(
          projectName || projectRootPath,
          {
            cwd: projectRootPath,
            recursive: true,
            filter: filterByField(sourceField, true),
            extraMonorepoStrategies,
          },
        );
        return projectsPromise;
      };

      api.modifyBundlerChain((chain, { CHAIN_ID }) => {
        // Rspack uses SourceBuildResolverPlugin below so the source condition is
        // applied only to dependent workspace projects discovered by the
        // monorepo analyzer. Keep the legacy rule configuration for other
        // bundlers.
        if (api.context.bundlerType === 'rspack') {
          return;
        }
        if (typeof resolvePriority !== 'string') {
          throw new Error(
            `[${PLUGIN_SOURCE_BUILD_NAME}] Per-package resolvePriority is only supported with Rspack.`,
          );
        }

        // TODO: remove `ts` when Rsbuild v1 is no longer supported.
        for (const ruleId of ['ts', CHAIN_ID.RULE.JS]) {
          if (chain.module.rules.get(ruleId)) {
            const rule = chain.module.rule(ruleId);

            // https://rspack.rs/config/resolve
            // when source is not exist, other mainFields will effect. // source > Rspack default mainFields.
            rule.resolve.mainFields.merge(
              resolvePriority === 'source'
                ? [sourceField, '...']
                : ['...', sourceField],
            );

            // `conditionNames` is not affected by `resolvePriority`.
            // The priority is controlled by the order of fields declared in `exports`.
            rule.resolve.conditionNames.add('...').add(sourceField);
          }
        }
      });

      const getReferences = async (
        tsconfigPath: string,
        rspackReferences?: string[] | 'auto',
      ): Promise<string[]> => {
        const references = new Set<string>();

        for (const project of await getProjects()) {
          const filePath = path.join(project.dir, 'tsconfig.json');
          if (fs.existsSync(filePath)) {
            references.add(filePath);
          }
        }

        // Add references in the current project's tsconfig.json
        const tsconfig = json5.parse<TsConfig>(
          fs.readFileSync(tsconfigPath, 'utf-8'),
        );

        const userReferences = [
          ...(Array.isArray(rspackReferences) ? rspackReferences : []),
          ...(tsconfig.references
            ? tsconfig.references.map((item) => item.path).filter(Boolean)
            : []),
        ];

        if (userReferences.length) {
          const baseDir = path.dirname(tsconfigPath);
          for (const item of userReferences) {
            if (!item) {
              continue;
            }

            const absolutePath = path.isAbsolute(item)
              ? item
              : path.join(baseDir, item);

            references.add(absolutePath);
          }
        }

        // avoid self reference, it will break the resolver
        references.delete(tsconfigPath);

        return Array.from(references);
      };

      if (api.context.bundlerType === 'rspack') {
        api.modifyRspackConfig(async (config, { environment }) => {
          const projects = await getProjects();
          const packages = createSourceBuildPackages(projects, {
            resolvePriority,
          });

          config.plugins ||= [];
          config.plugins.push(
            new SourceBuildResolverPlugin(packages, sourceField),
          );

          const { tsconfigPath } = environment;
          if (!tsconfigPath) {
            return;
          }

          config.resolve ||= {};

          const { tsConfig = { configFile: tsconfigPath } } = config.resolve;

          const configObject =
            typeof tsConfig === 'string' ? { configFile: tsConfig } : tsConfig;

          const references = await getReferences(
            tsconfigPath,
            configObject.references,
          );

          config.resolve.tsConfig = {
            configFile: configObject?.configFile || tsconfigPath,
            references: references,
          };
        });
      } else {
        // TODO: remove webpack branch when Rsbuild v1 is no longer supported.
        api.modifyBundlerChain(async (chain, { environment }) => {
          const { tsconfigPath } = environment;

          // @ts-expect-error Only Rsbuild v1 has `resolve.plugins` type
          if (!chain.resolve.plugins.has('ts-config-paths') || !tsconfigPath) {
            return;
          }

          const references = await getReferences(tsconfigPath);

          // set references config
          // https://github.com/dividab/tsconfig-paths-webpack-plugin#options
          // @ts-expect-error Only Rsbuild v1 has `resolve.plugins` type
          chain.resolve.plugin('ts-config-paths').tap((options) =>
            options.map((option: Record<string, unknown>) => ({
              ...option,
              references,
            })),
          );
        });
      }
    },
  };
}

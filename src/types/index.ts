import type { GetProjectsFunc } from '../common/getProjects.js';
import type { IsMonorepoFn } from '../common/isMonorepo.js';

export * from './packageJson.js';
export * from './rushJson.js';

/**
 * Adapter contract for discovering projects in a custom monorepo format.
 */
export interface MonorepoAnalyzer {
  /** Returns whether the given directory is the root of this monorepo type. */
  check: IsMonorepoFn;
  /** Returns every workspace project managed by this monorepo root. */
  getProjects: GetProjectsFunc;
}

export interface IPnpmWorkSpace {
  packages: string[];
}

export type TsConfig = {
  references?: Array<{ path?: string }>;
};

import type { GetProjectsFunc } from '../common/getProjects.js';
import type { IsMonorepoFn } from '../common/isMonorepo.js';

export * from './packageJson.js';
export * from './rushJson.js';

export interface MonorepoAnalyzer {
  check: IsMonorepoFn;
  getProjects: GetProjectsFunc;
}

export interface IPnpmWorkSpace {
  packages: string[];
}

export type TsConfig = {
  references?: Array<{ path?: string }>;
};

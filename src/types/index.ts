import type { GetProjectsFunc } from '../common/getProjects.ts';
import type { IsMonorepoFn } from '../common/isMonorepo.ts';

export * from './packageJson.ts';
export * from './rushJson.ts';

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

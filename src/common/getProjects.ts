import type { Project } from '../project.ts';
import type { IMonorepoBaseData } from './getBaseData.ts';
import { getProjects as getPnpmMonorepoSubProjects } from './pnpm.ts';
import { getProjects as getRushMonorepoSubProjects } from './rush.ts';

export type GetProjectsFunc = (
  rootPath: string,
) => Promise<Project[]> | Project[];

export const getMonorepoSubProjects = async (
  monorepoBaseData: IMonorepoBaseData,
): Promise<Project[]> => {
  const { type, rootPath, getProjects } = monorepoBaseData;
  if (type === 'pnpm') {
    return getPnpmMonorepoSubProjects(rootPath);
  }

  if (type === 'rush') {
    return getRushMonorepoSubProjects(rootPath);
  }

  if (getProjects) {
    return getProjects(rootPath);
  }

  return [];
};

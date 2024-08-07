import type { Project } from '../project.js';
import type { IMonorepoBaseData } from './getBaseData.js';
import { getProjects as getPnpmMonorepoSubProjects } from './pnpm.js';
import { getProjects as getRushMonorepoSubProjects } from './rush.js';

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

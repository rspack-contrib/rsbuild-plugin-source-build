export * from './getBaseData.ts';
export * from './isMonorepo.ts';

export { getMonorepoSubProjects } from './getProjects.ts';
export { getProjects as getPnpmMonorepoSubProjects } from './pnpm.ts';
export { getProjects as getRushMonorepoSubProjects } from './rush.ts';

export type { GetProjectsFunc } from './getProjects.ts';

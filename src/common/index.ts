export * from './getBaseData.js';
export * from './isMonorepo.js';

export { getMonorepoSubProjects } from './getProjects.js';
export { getProjects as getPnpmMonorepoSubProjects } from './pnpm.js';
export { getProjects as getRushMonorepoSubProjects } from './rush.js';

export type { GetProjectsFunc } from './getProjects.js';

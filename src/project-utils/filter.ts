import type { Project } from '../project.js';

type ExportsTarget =
  string | null | ExportsTarget[] | { [condition: string]: ExportsTarget };

export type Filter = FilterFunction;
export type FilterFunction = (
  projects: Project[],
) => Project[] | Promise<Project[]>;

function hasExportFieldTarget(
  target: ExportsTarget,
  fieldName: string,
  fieldMatched = false,
): boolean {
  if (typeof target === 'string') {
    return fieldMatched;
  }
  if (Array.isArray(target)) {
    return target.some((item) =>
      hasExportFieldTarget(item, fieldName, fieldMatched),
    );
  }
  if (!target) {
    return false;
  }

  return Object.entries(target).some(([key, value]) =>
    hasExportFieldTarget(value, fieldName, fieldMatched || key === fieldName),
  );
}

export const filterByField =
  (fieldName: string, checkExports?: boolean): FilterFunction =>
  (projects: Project[]) => {
    return projects.filter((p) => {
      return (
        fieldName in p.metaData ||
        (checkExports &&
          hasExportFieldTarget(p.metaData.exports || {}, fieldName))
      );
    });
  };

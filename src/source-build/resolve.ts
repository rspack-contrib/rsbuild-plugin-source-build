import path from 'node:path';
import type { Project } from '../project.js';

const SCOPED_PACKAGE_SEGMENTS = 2;

export type PackageResolvePriority = 'source' | 'output';

export type ResolvePriority =
  PackageResolvePriority | Record<string, PackageResolvePriority>;

export interface SourceBuildPackage {
  resolvePriority: PackageResolvePriority;
  root: string;
}

export type SourceBuildPackages = Map<string, SourceBuildPackage>;

export const PLUGIN_SOURCE_BUILD_RESOLVER_NAME =
  'rsbuild:source-build-resolver';

export function getPackageRequestName(request: string): string | undefined {
  if (request.startsWith('.') || path.isAbsolute(request)) {
    return;
  }

  const resource = request.split(/[?#]/, 1)[0];
  const segments = resource.split('/');
  const packageName = resource.startsWith('@')
    ? segments.slice(0, SCOPED_PACKAGE_SEGMENTS).join('/')
    : segments[0];

  if (
    !packageName ||
    (resource.startsWith('@') && segments.length < SCOPED_PACKAGE_SEGMENTS)
  ) {
    return;
  }
  return packageName;
}

export function getSourceBuildPackage(
  request: string,
  packages: SourceBuildPackages,
): SourceBuildPackage | undefined {
  const packageName = getPackageRequestName(request);
  return packageName ? packages.get(packageName) : undefined;
}

export function createSourceBuildPackages(
  projects: Project[],
  options: {
    resolvePriority: ResolvePriority;
  },
): SourceBuildPackages {
  return new Map(
    projects.map((project) => [
      project.name,
      {
        resolvePriority:
          typeof options.resolvePriority === 'string'
            ? options.resolvePriority
            : (options.resolvePriority[project.name] ?? 'source'),
        root: project.dir,
      },
    ]),
  );
}

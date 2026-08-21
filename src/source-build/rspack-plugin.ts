import fs from 'node:fs';
import path from 'node:path';
import type { Compiler, NormalModuleFactory, ResolveData } from '@rspack/core';
import {
  DependencyResolverTracker,
  type TrackedDependencyResolveData,
} from './dependency-resolver-tracker.js';
import {
  getPackageRequestName,
  getSourceBuildPackage,
  PLUGIN_SOURCE_BUILD_RESOLVER_NAME,
  type SourceBuildPackage,
  type SourceBuildPackages,
} from './resolve.js';

const NATIVE_RESOLUTION = Symbol('native-resolution');
const FIRST_PLUGIN_STAGE = Number.MIN_SAFE_INTEGER;
const LAST_PLUGIN_STAGE = Number.MAX_SAFE_INTEGER;

type RspackResolver = ReturnType<NormalModuleFactory['getResolver']>;
type RspackResolveOptions = Parameters<NormalModuleFactory['getResolver']>[1];
type CallbackResolver = (
  context: string,
  request: string,
  callback: (error: Error | null, result?: string | false) => void,
) => void;
type ScopedResolution = string | undefined | typeof NATIVE_RESOLUTION;
type AsyncResolver = (
  context: string,
  request: string,
) => Promise<string | false>;
type ScopedRequestResolver = (
  context: string,
  request: string,
) => Promise<ScopedResolution>;
type ExternalGetResolve = (options?: RspackResolveOptions) => CallbackResolver;

type ResolverFactory = {
  get(type: string, resolveOptions: RspackResolveOptions): RspackResolver;
};

interface DependencyResolveData extends TrackedDependencyResolveData {
  dependencyType?: string;
  /** Available in newer Rspack runtimes, but absent from Rspack 1.x. */
  getResolve?: ExternalGetResolve;
}

/**
 * Gets a normal resolver across the supported Rspack APIs.
 *
 * @remarks
 * Newer Rspack versions expose `NormalModuleFactory.getResolver`, while Rspack
 * 1.x requires using `Compilation.resolverFactory`.
 */
export function getNormalResolver(
  normalModuleFactory: Pick<NormalModuleFactory, 'getResolver'>,
  compilation: { resolverFactory: ResolverFactory },
  resolveOptions: RspackResolveOptions = { alias: false },
): RspackResolver {
  if (typeof normalModuleFactory.getResolver === 'function') {
    return normalModuleFactory.getResolver('normal', resolveOptions);
  }

  return compilation.resolverFactory.get('normal', resolveOptions);
}

/**
 * Appends resolver dependencies that are not already present in ResolveData.
 *
 * @remarks
 * This supports the Rspack 1.x fallback in {@link resolveCandidate}, whose
 * manually invoked resolver cannot register its dependencies through
 * `ExternalItemFunctionData.getResolve`.
 */
function mergeDependencies(target: string[], source: Set<string>): void {
  for (const dependency of source) {
    if (!target.includes(dependency)) {
      target.push(dependency);
    }
  }
}

function resolveWithCallback(
  resolver: CallbackResolver,
  context: string,
  request: string,
): Promise<string | false> {
  return new Promise((resolve, reject) => {
    resolver(context, request, (error, result) => {
      if (error) {
        reject(error);
      } else if (result === undefined) {
        reject(
          new Error(
            `[${PLUGIN_SOURCE_BUILD_RESOLVER_NAME}] Unable to resolve "${request}".`,
          ),
        );
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Resolves a request and propagates its resolution dependencies to Rspack.
 *
 * @remarks
 * Rspack 1.x does not provide `getResolve` to an externals callback. The plugin
 * therefore invokes `resolverFactory` directly and copies file, context, and
 * missing dependencies back to ResolveData so watch invalidation matches native
 * resolution.
 */
async function resolveCandidate(
  resolver: RspackResolver,
  data: ResolveData,
  candidate: string,
): Promise<string | false> {
  const fileDependencies = new Set(data.fileDependencies);
  const contextDependencies = new Set(data.contextDependencies);
  const missingDependencies = new Set(data.missingDependencies);

  try {
    return await new Promise<string | false>((resolve, reject) => {
      resolver.resolve(
        {},
        data.context,
        candidate,
        {
          fileDependencies,
          contextDependencies,
          missingDependencies,
        },
        (error, result) => {
          if (error) {
            reject(error);
          } else if (result === undefined) {
            reject(
              new Error(
                `[${PLUGIN_SOURCE_BUILD_RESOLVER_NAME}] Unable to resolve "${candidate}".`,
              ),
            );
          } else {
            resolve(result);
          }
        },
      );
    });
  } finally {
    mergeDependencies(data.fileDependencies, fileDependencies);
    mergeDependencies(data.contextDependencies, contextDependencies);
    mergeDependencies(data.missingDependencies, missingDependencies);
  }
}

function realpath(filePath: string): string {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

const packageRootCache = new WeakMap<SourceBuildPackage, string>();
const packageRootIndexCache = new WeakMap<
  SourceBuildPackages,
  Map<string, SourceBuildPackage>
>();

function getPackageRoot(sourceBuildPackage: SourceBuildPackage): string {
  let packageRoot = packageRootCache.get(sourceBuildPackage);
  if (!packageRoot) {
    packageRoot = realpath(sourceBuildPackage.root);
    packageRootCache.set(sourceBuildPackage, packageRoot);
  }
  return packageRoot;
}

function getPackageRootIndex(
  packages: SourceBuildPackages,
): Map<string, SourceBuildPackage> {
  let packageRootIndex = packageRootIndexCache.get(packages);
  if (!packageRootIndex) {
    packageRootIndex = new Map(
      Array.from(packages.values(), (sourceBuildPackage) => [
        getPackageRoot(sourceBuildPackage),
        sourceBuildPackage,
      ]),
    );
    packageRootIndexCache.set(packages, packageRootIndex);
  }
  return packageRootIndex;
}

function getResolvedResource(resolved: string): string {
  const escapedHash = '\0source-build-hash\0';
  return resolved
    .replaceAll('\u200b#', escapedHash)
    .split(/[?#]/, 1)[0]
    .replaceAll(escapedHash, '#');
}

function isInsidePackage(
  resolved: string | false,
  sourceBuildPackage: SourceBuildPackage,
): boolean {
  if (resolved === false) {
    return false;
  }

  const packageRoot = getPackageRoot(sourceBuildPackage);
  const relative = path.relative(
    packageRoot,
    realpath(getResolvedResource(resolved)),
  );
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function getScopedResolveOptions(
  resolvePriority: SourceBuildPackage['resolvePriority'],
  sourceField: string,
  dependencyType?: string,
): RspackResolveOptions {
  return {
    conditionNames: [sourceField, '...'],
    dependencyType,
    mainFields:
      resolvePriority === 'source'
        ? [sourceField, '...']
        : ['...', sourceField],
  };
}

function getResolvedSourceBuildPackage(
  resolved: string | false,
  packages: SourceBuildPackages,
): SourceBuildPackage | undefined {
  if (resolved === false) {
    return;
  }

  const packageRootIndex = getPackageRootIndex(packages);
  let currentPath = realpath(getResolvedResource(resolved));
  while (true) {
    const sourceBuildPackage = packageRootIndex.get(currentPath);
    if (sourceBuildPackage) {
      return sourceBuildPackage;
    }
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return;
    }
    currentPath = parentPath;
  }
}

async function resolveScopedRequest(
  request: string,
  packages: SourceBuildPackages,
  resolveNative: () => Promise<string | false>,
  resolveSourceBuild: (
    resolvePriority: SourceBuildPackage['resolvePriority'],
  ) => Promise<string | false>,
): Promise<ScopedResolution> {
  if (!getPackageRequestName(request)) {
    return;
  }

  let sourceBuildPackage: SourceBuildPackage | undefined;
  try {
    sourceBuildPackage = getResolvedSourceBuildPackage(
      await resolveNative(),
      packages,
    );
    if (!sourceBuildPackage) {
      return NATIVE_RESOLUTION;
    }
  } catch {
    sourceBuildPackage = getSourceBuildPackage(request, packages);
  }

  if (sourceBuildPackage) {
    try {
      const resolved = await resolveSourceBuild(
        sourceBuildPackage.resolvePriority,
      );
      return resolved !== false && isInsidePackage(resolved, sourceBuildPackage)
        ? resolved
        : NATIVE_RESOLUTION;
    } catch {
      return NATIVE_RESOLUTION;
    }
  }

  // Native resolution can fail for an alias to a source-only selected package.
  // Probe both field orders to discover the aliased project, then honor that
  // project's configured priority while retaining the successful probe as its
  // fallback when the preferred entry does not exist.
  for (const probePriority of ['source', 'output'] as const) {
    try {
      const resolved = await resolveSourceBuild(probePriority);
      if (resolved === false) {
        continue;
      }
      const resolvedPackage = getResolvedSourceBuildPackage(resolved, packages);
      if (!resolvedPackage) {
        continue;
      }
      if (resolvedPackage.resolvePriority === probePriority) {
        return resolved;
      }

      try {
        const preferred = await resolveSourceBuild(
          resolvedPackage.resolvePriority,
        );
        if (
          preferred !== false &&
          isInsidePackage(preferred, resolvedPackage)
        ) {
          return preferred;
        }
      } catch {
        // The successful probe is the package's configured fallback.
      }
      return resolved;
    } catch {
      // Try the next priority before falling back to native diagnostics.
    }
  }
  return NATIVE_RESOLUTION;
}

function createScopedRequestResolver(options: {
  packages: SourceBuildPackages;
  resolveNative: AsyncResolver;
  createSourceBuildResolver: (
    resolvePriority: SourceBuildPackage['resolvePriority'],
  ) => AsyncResolver;
}): ScopedRequestResolver {
  const { createSourceBuildResolver, packages, resolveNative } = options;
  const scopedResolvers = new Map<
    SourceBuildPackage['resolvePriority'],
    AsyncResolver
  >();

  return (context, request) =>
    resolveScopedRequest(
      request,
      packages,
      () => resolveNative(context, request),
      (resolvePriority) => {
        let resolver = scopedResolvers.get(resolvePriority);
        if (!resolver) {
          resolver = createSourceBuildResolver(resolvePriority);
          scopedResolvers.set(resolvePriority, resolver);
        }
        return resolver(context, request);
      },
    );
}

function createLoaderResolveOptions(
  options: Record<string, unknown> | undefined,
  resolvePriority: SourceBuildPackage['resolvePriority'],
  sourceField: string,
): Record<string, unknown> {
  const conditionNames = Array.isArray(options?.conditionNames)
    ? options.conditionNames
    : ['...'];
  const mainFields = Array.isArray(options?.mainFields)
    ? options.mainFields
    : ['...'];

  return {
    ...options,
    conditionNames: [sourceField, ...conditionNames],
    mainFields:
      resolvePriority === 'source'
        ? [sourceField, ...mainFields]
        : [...mainFields, sourceField],
  };
}

/**
 * Captures the dependency-specific resolver context before factorization.
 *
 * @remarks
 * Newer Rspack versions provide the exact `getResolve` function, preserving
 * rule-level and `byDependency` options. Rspack 1.x only provides the dependency
 * type, which is consumed by the resolverFactory compatibility fallback. The
 * no-op external is installed after user externals at the default factorize
 * stage, immediately before the scoped tap registered by the earliest
 * `thisCompilation` handler. This lets {@link DependencyResolverTracker}
 * serialize otherwise indistinguishable concurrent requests.
 */
function applyDependencyResolverTracker(
  compiler: Compiler,
): DependencyResolverTracker<DependencyResolveData> {
  const tracker = new DependencyResolverTracker<DependencyResolveData>();

  const applyTracker = () => {
    // ResolveData omits dependencyType and rule/byDependency resolve options.
    // A no-op external receives Rspack's exact getResolve function before the
    // scoped factorize tap; returning no result never externalizes a module.
    new compiler.rspack.ExternalsPlugin(
      'commonjs',
      (data: DependencyResolveData, callback: (error?: Error) => void) => {
        tracker.add(data, callback);
      },
    ).apply(compiler);
  };

  if (compiler.isChild()) {
    // Child compiler registration runs from Compilation.childCompiler after
    // its inherited and explicitly supplied plugins have already been applied.
    applyTracker();
  } else {
    // Install the tracker after other compiler plugins so its default-stage
    // externals tap is immediately followed by our factorize tap.
    compiler.hooks.afterPlugins.tap(
      {
        name: PLUGIN_SOURCE_BUILD_RESOLVER_NAME,
        stage: LAST_PLUGIN_STAGE,
      },
      applyTracker,
    );
  }
  return tracker;
}

function registerRspackCompiler(
  compiler: Compiler,
  packages: SourceBuildPackages,
  sourceField: string,
  registeredCompilers: WeakSet<Compiler>,
): void {
  if (registeredCompilers.has(compiler)) {
    return;
  }
  registeredCompilers.add(compiler);

  const dependencyResolvers = applyDependencyResolverTracker(compiler);

  compiler.hooks.thisCompilation.tap(
    {
      name: PLUGIN_SOURCE_BUILD_RESOLVER_NAME,
      stage: FIRST_PLUGIN_STAGE,
    },
    (compilation, { normalModuleFactory }) => {
      // A compiler reuses this tracker across watch compilations. Entries that
      // were not consumed because factorization bailed must not cross the
      // compilation boundary.
      dependencyResolvers.clear();

      const applyScopedResolution = async (
        data: ResolveData,
        dependencyData?: DependencyResolveData,
      ): Promise<void> => {
        const externalGetResolve = dependencyData?.getResolve;
        const nativeResolver = externalGetResolve
          ? externalGetResolve()
          : getNormalResolver(normalModuleFactory, compilation, {
              dependencyType: dependencyData?.dependencyType,
            });
        const resolve = createScopedRequestResolver({
          packages,
          resolveNative: externalGetResolve
            ? (context, request) =>
                resolveWithCallback(
                  nativeResolver as CallbackResolver,
                  context,
                  request,
                )
            : (_context, request) =>
                resolveCandidate(
                  nativeResolver as RspackResolver,
                  data,
                  request,
                ),
          createSourceBuildResolver: (resolvePriority) => {
            const resolveOptions = getScopedResolveOptions(
              resolvePriority,
              sourceField,
              dependencyData?.dependencyType,
            );
            if (externalGetResolve) {
              const callbackResolver = externalGetResolve(resolveOptions);
              return (context, request) =>
                resolveWithCallback(callbackResolver, context, request);
            }

            const rspackResolver = getNormalResolver(
              normalModuleFactory,
              compilation,
              resolveOptions,
            );
            return (_context, request) =>
              resolveCandidate(rspackResolver, data, request);
          },
        });
        const resolved = await resolve(data.context, data.request);

        if (typeof resolved === 'string') {
          data.request = resolved;
        }
      };

      normalModuleFactory.hooks.factorize.tapPromise(
        PLUGIN_SOURCE_BUILD_RESOLVER_NAME,
        async (data) => {
          const trackedRequest = data.request;
          const trackedIssuer = data.contextInfo.issuer;
          const dependencyData = dependencyResolvers.get(
            data.context,
            trackedRequest,
            trackedIssuer,
          );
          try {
            await applyScopedResolution(data, dependencyData);
          } finally {
            dependencyResolvers.release(
              data.context,
              trackedRequest,
              trackedIssuer,
            );
          }
        },
      );

      const { NormalModule } = compiler.rspack;
      NormalModule.getCompilationHooks(compilation).loader.tap(
        PLUGIN_SOURCE_BUILD_RESOLVER_NAME,
        (loaderContext) => {
          const getResolve = loaderContext.getResolve.bind(loaderContext);

          loaderContext.getResolve = ((options) => {
            const nativeResolver = getResolve(options) as CallbackResolver;
            const resolve = createScopedRequestResolver({
              packages,
              resolveNative: (context, request) =>
                resolveWithCallback(nativeResolver, context, request),
              createSourceBuildResolver: (resolvePriority) => {
                const resolver = getResolve(
                  createLoaderResolveOptions(
                    options as Record<string, unknown> | undefined,
                    resolvePriority,
                    sourceField,
                  ),
                ) as CallbackResolver;
                return (context, request) =>
                  resolveWithCallback(resolver, context, request);
              },
            });

            const resolveWithNativeFallback = async (
              context: string,
              request: string,
            ): Promise<string | false> => {
              const resolved = await resolve(context, request);

              if (resolved === NATIVE_RESOLUTION || resolved === undefined) {
                return resolveWithCallback(nativeResolver, context, request);
              }
              return resolved;
            };

            return (
              context: string,
              request: string,
              callback?: (error: Error | null, result?: string | false) => void,
            ) => {
              const promise = resolveWithNativeFallback(context, request);
              if (callback) {
                promise.then(
                  (result) => callback(null, result),
                  (error) => callback(error as Error),
                );
                return;
              }
              return promise;
            };
          }) as typeof loaderContext.getResolve;
        },
      );

      compilation.hooks.childCompiler?.tap(
        {
          name: PLUGIN_SOURCE_BUILD_RESOLVER_NAME,
          stage: LAST_PLUGIN_STAGE,
        },
        (childCompiler) => {
          registerRspackCompiler(
            childCompiler,
            packages,
            sourceField,
            registeredCompilers,
          );
        },
      );
    },
  );
}

export class SourceBuildResolverPlugin {
  name = PLUGIN_SOURCE_BUILD_RESOLVER_NAME;

  constructor(
    private readonly packages: SourceBuildPackages,
    private readonly sourceField: string,
  ) {}

  apply(compiler: Compiler): void {
    registerRspackCompiler(
      compiler,
      this.packages,
      this.sourceField,
      new WeakSet(),
    );
  }
}

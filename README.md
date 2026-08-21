# @rsbuild/plugin-source-build

An Rsbuild plugin to provide support for monorepo source code referencing.

`@rsbuild/plugin-source-build` allows referencing source code from other subdirectories of monorepo and performs the build and hot updates.

<p>
  <a href="https://npmjs.com/package/@rsbuild/plugin-source-build">
   <img src="https://img.shields.io/npm/v/@rsbuild/plugin-source-build?style=flat-square&colorA=564341&colorB=EDED91" alt="npm version" />
  </a>
  <img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square&colorA=564341&colorB=EDED91" alt="license" />
</p>

English | [简体中文](./README.zh-CN.md)

## Usage

Install:

```bash
npm add @rsbuild/plugin-source-build -D
```

Add plugin to your `rsbuild.config.ts`:

```ts
// rsbuild.config.ts
import { pluginSourceBuild } from '@rsbuild/plugin-source-build';

export default {
  plugins: [pluginSourceBuild()],
};
```

## Use Cases

In a monorepo, there are two main ways for projects to reference each other: **artifact referencing and source code referencing**. Let's use a simple monorepo as an example to illustrate the use case of source code referencing.

For example, the monorepo contains an app application and a lib:

```ts
monorepo
├── app
└── lib
    └── src
        └── index.ts
```

The app is built using Rsbuild and relies on some methods from the lib:

```json
{
  "name": "app",
  "dependencies": {
    "lib": "workspace:*"
  }
}
```

### Artifact Referencing

**When using artifact referencing, the current project references the artifacts built from other sub-projects.**

In the example above, the lib is written in TypeScript. Typically, we need to build the lib's code in advance to generate JavaScript artifacts so that the app can reference it correctly. When the lib's code is updated, we need to rebuild it (or use `tsc --watch`) to ensure that the app can use the latest code.

The advantages of this approach are:

- The build processes of each sub-project are completely independent and can have different build configurations.
- Build caching can be applied to individual sub-projects.

The disadvantages are:

- The HMR chain becomes longer during local development.
- The process becomes cumbersome when a project contains multiple lib packages.

### Source Code Referencing

**When using source code referencing, the current project references the source code of other sub-projects for building.**

In the example mentioned earlier, when you register the `@rsbuild/plugin-source-build` and add the relevant configuration in the `lib` directory, Rsbuild will automatically reference the `src/index.ts` source code of the lib. This means that you don't need to build the lib's code in advance, and when the source code of the lib is updated, it can trigger automatic hot updates for the app.

The advantages of this approach are:

- The sub-project does not rely on a build tool and does not require build configurations. The code of the sub-project will be compiled by the build tool of the current project.
- There is no need to execute the build process for the sub-projects in advance.
- HMR is more efficient during local development.

The disadvantages are:

- The current project needs to support syntax features used by sub-projects and follow the same syntax specifications, such as using a consistent version of decorator syntax. If the current project and sub-projects require different build configurations, building from source code may not be suitable.
- The current project requires compiling more code, which may result in longer build times.

### Configuring Sub-projects

When the `@rsbuild/plugin-source-build` is registered, the Rsbuild will prioritize reading the file specified in the `source` field of the sub-project during the build process. Therefore, you need to configure the `source` field in the package.json file of the sub-project and point it to the source code file.

For example, in the following example, when the lib package is referenced, the `./src/index.ts` file will be read for building:

```json title="package.json"
{
  "name": "lib",
  "main": "./dist/index.js",
  "source": "./src/index.ts"
}
```

If the sub-project uses the [exports](https://nodejs.org/api/packages.html#package-entry-points) field, you also need to add the `source` field to `exports`.

Note that the declaration order of keys in `exports` affects resolution, so it is recommended to place the `source` field first in each export condition object to ensure the resolver prioritizes the module pointed to by `source`.

```json title="package.json"
{
  "name": "lib",
  "exports": {
    ".": {
      "source": "./src/index.ts",
      "default": "./dist/index.js"
    },
    "./features": {
      "source": "./src/features/index.ts",
      "default": "./dist/features/index.js"
    }
  }
}
```

### Customizing Source Field

Although the plugin uses the `source` field by default to specify the source file, we recommend configuring a custom field through the [sourceField](#sourceField) option (for example, `@custom/source`, where `custom` can be replaced with any scope name).

```ts
pluginSourceBuild({
  sourceField: '@custom/source',
});
```

This makes the source-build contract explicit and avoids conflicts with packages
that use `source` for another purpose. When using Rspack, the plugin additionally
limits source resolution to dependent workspace projects discovered by the
active monorepo analyzer, so unrelated `node_modules` packages are not affected.

## Scoped Source Resolution

With Rspack, the plugin derives the source-build boundary from the monorepo
project graph. Starting from the current project, it recursively follows package
dependencies and keeps only workspace projects that declare `sourceField`.
Requests for those package names can resolve to source; all other package
requests continue through Rspack's native resolver.

Selected requests are still resolved by Rspack itself. The plugin adds
`sourceField` to a scoped resolver rather than changing the global resolver, so
target and dependency conditions, aliases, `resolvePriority`, and native
output/source fallback behavior are preserved.

As with normal Rspack resolution, a selected package must still be reachable
through a workspace link, alias, or tsconfig path. The monorepo adapter defines
the allowed scope; it does not register packages with the resolver.

Custom monorepo integrations can provide that project graph through
`extraMonorepoStrategies`. TypeScript project references are then augmented
with the selected projects, but existing `tsconfig.json` references do not add
packages to the source-build boundary.

## Configure Project Reference

In a TypeScript project, you need to use the capability provided by TypeScript called [Project Reference](https://typescriptlang.org/docs/handbook/project-references). It helps you develop source code more effectively.

### Introduction

Project reference provides the following capabilities:

- It allows TypeScript to correctly recognize the types of other sub-projects without the need to build them.
- When you navigate the code in VS Code, it automatically takes you to the corresponding source code file of the module.
- Rsbuild reads the project reference configuration and automatically recognizes the `tsconfig.compilerOptions.path` configuration of the sub-project, so that the use of aliases in the sub-project works correctly.

### Example

In the example mentioned earlier, since the app project references the lib sub-project, we need to configure the `references` options in the app project's `tsconfig.json` to point to the relative directory of the lib:

```json title="app/tsconfig.json"
{
  "references": [
    {
      "path": "../lib"
    }
  ]
}
```

At the same time, we need to set `composite` to `true` in the lib project's `tsconfig.json`:

```json title="lib/A/tsconfig.json"
{
  "compilerOptions": {
    "composite": true
  }
}
```

After adding these two options, the project reference is already configured. You can restart VS Code to see the effects of the configuration.

Note that the above example is a simplified one. In real monorepo projects, there may be more complex dependency relationships. You need to add a complete `references` configuration for the functionality to work correctly.

> If you want to learn more about project reference, please refer to the official documentation on [TypeScript - Project References](https://typescriptlang.org/docs/handbook/project-references).

## Options

### sourceField

- **Type:** `string`
- **Default:** `'source'`

Used to configure the resolve field of the source code files.

For example, when configured as `@custom/source`:

```ts
pluginSourceBuild({
  sourceField: '@custom/source',
});
```

In `package.json`, the source code file path can be specified using `@custom/source`:

```json title="package.json"
{
  "name": "lib",
  "main": "./dist/index.js",
  "@custom/source": "./src/index.ts",
  "exports": {
    ".": {
      "@custom/source": "./src/index.ts",
      "default": "./dist/index.js"
    }
  }
}
```

If you use a custom field name configured via `sourceField` in `exports` (for example, `@custom/source`), place that field first in each export condition object, since the key order in `exports` affects resolution priority.

### resolvePriority

- **Type:** `'source' | 'output' | Record<string, 'source' | 'output'>`
- **Default:** `'source'`

Used to control the priority of reading the source code or the output code. A
string applies to every selected workspace package. An object overrides the
priority by package name; selected packages omitted from the object use
`'source'`. The object does not select packages—the active monorepo strategy and
the package dependency graph still determine the source-build boundary.
Per-package priority maps are supported only when using Rspack.

By default, `@rsbuild/plugin-source-build` will reading the source code first, for example, in the following example, it will read the `source` field.

```json title="package.json"
{
  "name": "lib",
  "main": "./dist/index.js",
  "source": "./src/index.ts"
}
```

When `resolvePriority` is set to `'output'`, `@rsbuild/plugin-source-build` will read the output code first, i.e., the code from the `main` or `module` field.

```ts
pluginSourceBuild({
  resolvePriority: 'output',
});
```

Different workspace packages can use different priorities:

```ts
pluginSourceBuild({
  resolvePriority: {
    '@example/components': 'source',
    '@example/utils': 'output',
  },
});
```

- The `exports` field in package.json is not affected by `resolvePriority`.
- The keys order in `exports` determines the resolving order, earlier declared keys having higher priority.

### projectName

- **Type:** `string`
- **Default:** The package name at the Rsbuild project root

Specifies the current project in the workspace project graph. Framework
integrations can pass the package name they already resolved from their own
application context.

### extraMonorepoStrategies

- **Type:** `Record<string, MonorepoAnalyzer>`
- **Default:** `undefined`

Adds adapters for monorepo formats other than the built-in pnpm workspace and
Rush formats. Both `MonorepoAnalyzer` and `Project` are exported from the
package root:

```ts
import {
  type MonorepoAnalyzer,
  pluginSourceBuild,
  Project,
} from '@rsbuild/plugin-source-build';

const customAnalyzer: MonorepoAnalyzer = {
  check: async (root) => isCustomMonorepo(root),
  getProjects: async (root) => {
    const workspacePackages = await readCustomWorkspace(root);
    return Promise.all(
      workspacePackages.map(async ({ name, dir }) => {
        const project = new Project(name, dir);
        await project.init();
        return project;
      }),
    );
  },
};

pluginSourceBuild({
  projectName: '@example/app',
  extraMonorepoStrategies: {
    custom: customAnalyzer,
  },
});
```

The adapter should return all workspace projects. The plugin treats that result
as the project boundary, recursively follows the current project's package
dependencies within it, and enables source resolution only for the resulting
projects that declare `sourceField`.

## Caveat

When using `@rsbuild/plugin-source-build`, there are a few things to keep in mind:

1. Ensure that the current project can compile the syntax or features used in the sub-project. For example, if the sub-project uses Stylus to write CSS, the current app needs to support Stylus compilation.
2. Ensure that the current project has the same code syntax and features as the sub-project, such as consistent syntax versions for decorators.
3. Source code building may have some limitations. When encountering issues, you can remove the `source` field from the sub-project's package.json and debug using the built artifacts of the sub-project.
4. When `composite: true` is enabled, TypeScript will generate `*.tsbuildinfo` temporary files. You need to add these temporary files to the `.gitignore` file.

```text title=".gitignore"
*.tsbuildinfo
```

## License

[MIT](./LICENSE).

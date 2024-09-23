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
import { pluginSourceBuild } from "@rsbuild/plugin-source-build";

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

If the sub-project uses [exports](https://nodejs.org/api/packages.html#package-entry-points) field, you also need to add the `source` field in the `exports` field.

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

## Configure Project Reference

In a TypeScript project, you need to use the capability provided by TypeScript called [Project Reference](https://typescriptlang.org/docs/handbook/project-references). It helps you develop source code more effectively.

### Introduction

Project reference provides the following capabilities:

- It allows TypeScript to correctly recognize the types of other sub-projects without the need to build them.
- When you navigate the code in VS Code, it automatically takes you to the corresponding source code file of the module.
- Rsbuild reads the project reference configuration and automatically recognizes the `tsconfig.compilerOptions.path` configuration of the sub-project, so that the use of aliases in the sub-project works correctly.

### Example

In the example mentioned earlier, since the app project references the lib sub-project, we need to configure the `composite` and `references` options in the app project's `tsconfig.json` file and point them to the corresponding relative directory of lib:

```json title="app/tsconfig.json"
{
  "compilerOptions": {
    "composite": true
  },
  "references": [
    {
      "path": "../lib"
    }
  ]
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

For example, when configured as `my-source`:

```ts
pluginSourceBuild({
  sourceField: "my-source",
});
```

In `package.json`, the source code file path can be specified using `my-source`:

```json title="package.json"
{
  "name": "lib",
  "main": "./dist/index.js",
  "my-source": "./src/index.ts",
  "exports": {
    ".": {
      "my-source": "./src/index.ts",
      "default": "./dist/index.js"
    }
  }
}
```

### resolvePriority

- **Type:** `'source' | 'output'`
- **Default:** `'source'`

Used to control the priority of reading the source code or the output code.

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
  resolvePriority: "output",
});
```

- The `exports` field in package.json is not affected by `resolvePriority`.
- The keys order in `exports` determines the resolving order, earlier declared keys having higher priority.

## Caveat

When using `@rsbuild/plugin-source-build`, there are a few things to keep in mind:

1. Ensure that the current project can compile the syntax or features used in the sub-project. For example, if the sub-project uses Stylus to write CSS, the current app needs to support Stylus compilation.
2. Ensure that the current project has the same code syntax and features as the sub-project, such as consistent syntax versions for decorators.
3. Source code building may have some limitations. When encountering issues, you can remove the `source` field from the sub-project's package.json and debug using the built artifacts of the sub-project.
4. When `composite: true` is enabled, TypeScript will generate `*.tsbuildinfo` temporary files. You need to add these temporary files to the `.gitignore` file. And be careful not to execute the build of sub-project independently (When building the current project, the `tsbuildinfo` generated by the sub-project build cannot be reused.).

```text title=".gitignore"
*.tsbuildinfo
```

## License

[MIT](./LICENSE).

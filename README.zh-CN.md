# @rsbuild/plugin-source-build

提供对 monorepo 源代码引用的支持。

`@rsbuild/plugin-source-build` 用于 monorepo 开发场景，它支持从当前项目引用其他子目录的源代码，并完成构建和热更新。

<p>
  <a href="https://npmjs.com/package/@rsbuild/plugin-source-build">
   <img src="https://img.shields.io/npm/v/@rsbuild/plugin-source-build?style=flat-square&colorA=564341&colorB=EDED91" alt="npm version" />
  </a>
  <img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square&colorA=564341&colorB=EDED91" alt="license" />
</p>

## 使用

安装：

```bash
npm add @rsbuild/plugin-source-build -D
```

在 `rsbuild.config.ts` 里注册插件:

```ts
// rsbuild.config.ts
import { pluginSourceBuild } from '@rsbuild/plugin-source-build';

export default {
  plugins: [pluginSourceBuild()],
};
```

## 使用场景

在 monorepo 中，子项目互相引用主要有两种方式 —— **产物引用和源码引用**。我们以一个最简单的 monorepo 为例子，来介绍源码引用的使用场景。

比如 monorepo 中包含了一个 app 应用和一个 lib 包：

```ts
monorepo
├── app
└── lib
    └── src
        └── index.ts
```

其中，app 是基于 Rsbuild 构建的，app 依赖了 lib 中的一些方法：

```json
{
  "name": "app",
  "dependencies": {
    "lib": "workspace:*"
  }
}
```

### 产物引用

**产物引用指的是当前项目引用其他子项目构建后的产物。**

比如上述例子中的 lib 是使用 TypeScript 编写的，通常情况下，我们需要提前构建 lib 的代码，生成 JavaScript 产物，这样 app 才可以正确引用它。当 lib 代码更新时，还需要重新执行一次构建（或者使用 `tsc --watch`），否则 app 无法引用到最新的代码。

这种方式的优势在于：

- 各个子项目的构建过程是完全独立的，可以拥有不同的构建配置。
- 可以针对子项目进行构建缓存。

劣势在于：

- 本地开发时 HMR 的链路变长。
- 当一个项目中包含多个 lib 包时，以上过程会显得十分繁琐。

### 源码引用

**源码引用指的是当前项目引用其他子项目的源码进行构建。**

比如上述例子，当你注册了 `@rsbuild/plugin-source-build`，并在 lib 中添加相关配置后，Rsbuild 会自动引用 lib 的 `src/index.ts` 源代码。这意味着，你不需要提前构建 lib 的代码，并且当 lib 的源代码更新时，也可以自动触发 app 的热更新。

这种方式的优势在于：

- 子项目不依赖构建工具，也不需要添加构建配置，子项目的代码会被当前项目的构建工具编译。
- 不需要提前执行子项目的构建流程。
- 本地开发时 HMR 更高效。

劣势在于：

- 当前项目需要支持子项目用到的语法特性，并且遵循相同的语法规范，比如使用一致的装饰器语法版本。如果当前项目和子项目需要使用不同的编译配置，则不适合使用 `@rsbuild/plugin-source-build`。
- 当前项目需要编译更多的代码，因此构建时间可能会变长。

### 配置子项目

当注册 `@rsbuild/plugin-source-build`后，Rsbuild 在构建过程中，会优先读取子项目的 `source` 字段对应的文件。因此，你需要在子项目的 package.json 中配置 `source` 字段，并且指向源码文件路径。

比如以下例子，当 lib 包被引用时，会读取 `./src/index.ts` 文件进行构建：

```json title="package.json"
{
  "name": "lib",
  "main": "./dist/index.js",
  "source": "./src/index.ts"
}
```

如果子项目使用了 [exports](https://nodejs.org/api/packages.html#package-entry-points) 配置，那么你同样需要在 `exports` 中增加 `source` 字段。

需要注意的是，`exports` 中 key 的声明顺序会影响解析结果，因此建议将 `source` 字段放在每个导出条件对象的第一个位置，以确保解析器优先解析 `source` 对应的模块。

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

### 自定义 source 字段

虽然插件默认使用 `source` 字段来指定源代码文件，但我们更推荐通过 [sourceField](#sourceField) 选项配置一个自定义字段（例如 `@custom/source`，其中 `custom` 可以替换为任意 scope 名称）。

```ts
pluginSourceBuild({
  sourceField: '@custom/source',
});
```

这样可以明确源码构建约定，并避免与其他用途的 `source` 字段冲突。使用
Rspack 时，插件还会把源码解析限定在当前 monorepo analyzer 找到的 workspace
依赖项目内，不会影响无关的 `node_modules` 包。

## 限定源码解析范围

使用 Rspack 时，插件会从 monorepo 项目图中确定源码构建范围：从当前项目出发，
递归读取 package 依赖关系，并只保留声明了 `sourceField` 的 workspace 项目。
只有这些包名对应的请求可以解析到源码，其他包请求继续使用 Rspack 原生解析。

选中的请求仍由 Rspack 原生 resolver 解析。插件只在限定 resolver 中补充
`sourceField`，不会修改全局 resolver，因此可以保留 target、依赖类型、alias、
`resolvePriority` 以及 output/source fallback 等原生语义。

与普通 Rspack 解析一致，选中的包仍需通过 workspace link、alias 或 tsconfig path
可达。monorepo Adapter 只负责限定允许生效的范围，不负责向 resolver 注册包。

自定义 monorepo 集成可以通过 `extraMonorepoStrategies` 提供项目图。插件会把选中的
项目补充到 TypeScript project references；但 `tsconfig.json` 中原有的 references
不会反向扩大源码构建的包范围。

## 配置 Project Reference

在 TypeScript 项目中，你需要使用 TypeScript 提供的 [Project Reference](https://typescriptlang.org/docs/handbook/project-references) 能力，它可以帮助你更好地使用源码开发。

### 介绍

Project reference 提供了以下能力：

- 使 TypeScript 可以正确识别其他子项目的类型，而无须对子项目进行构建。
- 当你在 VS Code 内进行代码跳转时，VS Code 可以自动跳转到对应模块的源代码文件。
- Rsbuild 会读取 project reference 配置，并自动识别子项目的 `tsconfig.compilerOptions.path` 配置，从而让子项目的别名可以正确生效。

### 示例

在上文的例子中，由于 app 引用了 lib 子项目，我们需要在 app 的 `tsconfig.json` 内配置 `references`，并指向 lib 对应的相对目录：

```json title="app/tsconfig.json"
{
  "references": [
    {
      "path": "../lib"
    }
  ]
}
```

同时，需要在 lib 子项目的 `tsconfig.json` 内配置 `composite` 为 `true`：

```json title="lib/A/tsconfig.json"
{
  "compilerOptions": {
    "composite": true
  }
}
```

添加以上两个选项后，project reference 就已经配置完成了，你可以重新启动 VS Code 来查看配置以后的效果。

注意以上只是一个最简单的例子，在实际的 monorepo 项目中，可能会有更复杂的依赖关系，你需要添加完整的 `references` 配置，才能使上述功能正确运作。

> 如果你想了解更多关于 project reference 的内容，请阅读 [TypeScript - Project References](https://typescriptlang.org/docs/handbook/project-references) 官方文档。

## 选项

### sourceField

- **类型：** `string`
- **默认值：** `'source'`

用于配置源代码文件对应的解析字段。

比如配置为 `@custom/source`：

```ts
pluginSourceBuild({
  sourceField: '@custom/source',
});
```

在 `package.json` 中，即可通过 `@custom/source` 指定源代码文件的路径：

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

如果你在 `exports` 中使用了通过 `sourceField` 配置的自定义字段名（例如 `@custom/source`），请将该字段放在每个导出条件对象的最前面。因为 `exports` 中键的顺序会影响解析优先级。

### resolvePriority

- **类型：** `'source' | 'output' | Record<string, 'source' | 'output'>`
- **默认值：** `'source'`

用于控制优先读取源代码还是产物代码。传入字符串时会作用于所有选中的 workspace
包；传入对象时会按包名覆盖优先级，对象中未配置的已选中包使用 `'source'`。
这个对象不负责选择包，源码构建范围仍由当前 monorepo Strategy 和 package 依赖图决定。
包级优先级对象仅支持在 Rspack 中使用。

默认情况下，`@rsbuild/plugin-source-build`会优先读取源代码，比如在下面的例子中，它会读取 `source` 字段。

```json title="package.json"
{
  "name": "lib",
  "main": "./dist/index.js",
  "source": "./src/index.ts"
}
```

当 `resolvePriority` 设置为 `'output'` 时，`@rsbuild/plugin-source-build`会优先读取产物代码，即 `main` 或 `module` 字段指向的代码。

```ts
pluginSourceBuild({
  resolvePriority: 'output',
});
```

不同 workspace 包可以配置不同的解析优先级：

```ts
pluginSourceBuild({
  resolvePriority: {
    '@example/components': 'source',
    '@example/utils': 'output',
  },
});
```

- package.json 中的 `exports` 字段不受 `resolvePriority` 的影响。
- `exports` 中 key 的声明顺序决定了读取顺序，较早声明的 key 具有更高的优先级。

### projectName

- **类型：** `string`
- **默认值：** Rsbuild 项目根目录对应的包名

用于指定 workspace 项目图中的当前项目。框架集成可以直接传入其应用上下文中已经
确定的包名。

### extraMonorepoStrategies

- **类型：** `Record<string, MonorepoAnalyzer>`
- **默认值：** `undefined`

用于为 pnpm workspace 和 Rush 以外的 monorepo 格式增加 Adapter。
`MonorepoAnalyzer` 和 `Project` 均可从包根入口导入：

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

Adapter 应返回全部 workspace 项目。插件会把该结果作为项目边界，只在其中递归读取
当前项目的 package 依赖关系，并仅对最终选中且声明了 `sourceField` 的项目启用源码解析。

## 注意事项

在使用 `@rsbuild/plugin-source-build`的时候，需要注意几点：

1. 需要保证当前项目可以编译子项目里使用的语法或特性。比如子项目使用了 Stylus 来编写 CSS 样式，那就需要当前 app 支持 Stylus 编译。
2. 需要保证当前项目与子项目使用的代码语法特性相同，例如装饰器的语法版本一致。
3. 源码构建可能存在一些限制。如果在使用中遇到问题，你可以将子项目 package.json 中的 `source` 字段移除，使用子项目的构建产物进行调试。
4. 开启 `composite: true` 后，TypeScript 会生成 `*.tsbuildinfo` 临时文件，你需要将这些临时文件加入 .gitignore 中。

```text title=".gitignore"
*.tsbuildinfo
```

## License

[MIT](./LICENSE).

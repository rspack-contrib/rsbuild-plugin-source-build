import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginSourceBuild } from '@rsbuild/plugin-source-build';
import { pluginTypeCheck } from '@rsbuild/plugin-type-check';

export default defineConfig({
  plugins: [
    pluginSourceBuild(),
    pluginReact(),
    pluginTypeCheck({
      tsCheckerOptions: {
        typescript: {
          // test/index.test.ts builds the referenced fixture declarations before
          // Rsbuild starts, so this checker only needs to validate the app project.
          build: false,
        },
      },
    }),
  ],
});

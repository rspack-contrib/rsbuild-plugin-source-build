import { defineConfig } from '@rsbuild/core';
import { pluginSourceBuild } from '../src';

export default defineConfig({
  plugins: [pluginSourceBuild()],
});

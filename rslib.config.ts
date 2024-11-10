import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    { format: 'esm', syntax: 'es2021', dts: true },
    {
      format: 'cjs',
      syntax: 'es2021',
      output: {
        externals: {
          yaml: 'import yaml',
        },
      },
    },
  ],
  output: {
    target: 'node',
  },
});

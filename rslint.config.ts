import { defineConfig, js, ts } from '@rslint/core';

export default defineConfig([
  js.configs.recommended,
  ts.configs.recommended,
  {
    files: ['playground/**/*'],
    rules: {
      'no-undef': 'off',
    },
  },
]);

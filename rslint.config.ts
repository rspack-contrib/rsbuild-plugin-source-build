import { defineConfig, globals, js, ts } from '@rslint/core';

export default defineConfig([
  js.configs.recommended,
  ts.configs.recommended,
  {
    files: ['playground/src/**/*'],
    languageOptions: {
      globals: globals.browser,
    },
  },
]);

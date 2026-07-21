import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, test } from '@rstest/playwright';
import { createRsbuild, loadConfig } from '@rsbuild/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

beforeAll(() => {
  const typescriptDir = dirname(require.resolve('typescript/package.json'));

  // TypeScript 7's native checker cannot build project references while the
  // type-check plugin runs it in read-only `--noEmit` mode. Emit the referenced
  // fixture declarations first so the app check can consume them from disk.
  execFileSync(
    process.execPath,
    [
      join(typescriptDir, 'bin', 'tsc'),
      '--build',
      join(__dirname, 'components', 'tsconfig.json'),
    ],
    { stdio: 'inherit' },
  );
});

test('should build succeed', async ({ page }) => {
  const cwd = join(__dirname, 'app');
  const rsbuild = await createRsbuild({
    cwd,
    rsbuildConfig: (await loadConfig({ cwd })).content,
  });

  await rsbuild.build();
  const { server, urls } = await rsbuild.preview();

  await page.goto(urls[0]);

  const locator = page.locator('#root');
  await expect(locator).toHaveText(
    'Card Comp Title: appCARD COMP CONTENT:hello world',
  );

  await server.close();
});

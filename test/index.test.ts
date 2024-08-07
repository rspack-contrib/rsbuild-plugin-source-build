import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { createRsbuild, loadConfig } from '@rsbuild/core';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

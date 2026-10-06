import { test, expect } from '@playwright/test';

test('task setup keeps the required task and optional criteria centered with advanced controls collapsed', async ({ page }) => {
  await page.goto('/');
  const task = page.getByRole('textbox', { name: 'Task description', exact: true });
  const criteria = page.getByRole('textbox', { name: 'Completion criteria', exact: true });
  await expect(task).toBeVisible();
  await expect(task).toHaveAttribute('required', '');
  await expect(criteria).not.toHaveAttribute('required', '');
  await expect(page.getByText('Leave blank to generate completion criteria from your task before research starts.')).toBeVisible();
  await expect(page.getByLabel('Research mode')).not.toBeVisible();
  const a = (await task.boundingBox())!;
  const b = (await criteria.boundingBox())!;
  expect(a.height).toBeGreaterThan(b.height);
  expect(Math.abs(a.width - b.width)).toBeLessThan(1);
  expect(a.width).toBeGreaterThan(350);
  expect(a.width).toBeLessThan(600);
  expect(Math.abs(a.x + a.width / 2 - (222 + (1440 - 222) / 2))).toBeLessThan(10);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(task).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

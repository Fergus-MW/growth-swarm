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

test('criteria generation failure preserves the task and exact explicit criteria can be retried', async ({ page }) => {
  await page.goto('/');
  const task = page.getByRole('textbox', { name: 'Task description', exact: true });
  const criteria = page.getByRole('textbox', { name: 'Completion criteria', exact: true });
  const description = 'Research '.repeat(2100);
  await task.fill(description);
  await page.getByRole('button', { name: 'Launch research', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not generate completion criteria');
  await expect(task).toHaveValue(description);
  await expect(criteria).toHaveValue('');
  const explicit = '  Compare the options.\nKeep unknowns visible.  ';
  await criteria.fill(explicit);
  const admitted = page.waitForResponse(response => response.url().endsWith('/api/runs') && response.request().method() === 'POST' && response.status() === 201);
  await page.getByRole('button', { name: 'Launch research', exact: true }).click();
  const run = await (await admitted).json();
  expect(run.config.objective).toBe(description);
  expect(run.config.criteria.text).toBe(explicit);
  expect(run.config.profile).toBe('blank');
  expect(run.config.criteria.minCompanies).toBe(0);
  expect(run.config.criteria.requireContacts).toBe(false);
});

test('editing free-text criteria replaces the old profile gates and recognizes explicit numeric rules', async ({ page }) => {
  await page.goto('/');
  await page.locator('.task-advanced > summary').click();
  await page.getByRole('button', { name: 'Go-to-market' }).click();
  await expect(page.locator('#min-companies')).toHaveValue('50');
  await page.getByRole('textbox', { name: 'Completion criteria', exact: true }).fill('Summarize the public evidence and unresolved questions.');
  await page.getByRole('button', { name: 'Go-to-market' }).click();
  await expect(page.getByRole('textbox', { name: 'Completion criteria', exact: true })).toHaveValue('Summarize the public evidence and unresolved questions.');
  await expect(page.locator('#min-companies')).toHaveValue('0');
  await expect(page.locator('#signal-percent')).toHaveValue('0');
  await expect(page.getByLabel('Require a confirmed founder or CEO')).not.toBeChecked();
  await page.getByRole('textbox', { name: 'Completion criteria', exact: true }).fill('Find at least 3 qualified companies with two independent source origins.');
  await expect(page.locator('#min-companies')).toHaveValue('3');
  await expect(page.locator('#independent-sources')).toHaveValue('2');
});

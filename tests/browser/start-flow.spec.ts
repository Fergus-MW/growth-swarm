import { test, expect } from '@playwright/test';
import { useDemoGtm } from './helpers';

test('Start is the single primary action below the completion threshold', async ({ page }) => {
  await page.goto('/');
  const start = page.getByRole('button', { name: 'Start', exact: true });
  await expect(start).toBeVisible({ timeout: 3000 });
  await expect(start).toBeDisabled();
  const threshold = (await page.locator('#threshold').boundingBox())!;
  const action = (await start.boundingBox())!;
  expect(action.y).toBeGreaterThan(threshold.y + threshold.height);
  expect(action.width).toBe(threshold.width);
  await page.screenshot({ path: 'test-results/start-setup-desktop.png', fullPage: true });
  await page.locator('#objective').fill('  ');
  await expect(start).toBeDisabled();
  await page.locator('#objective').fill('Hi');
  await expect(start).toBeEnabled();
});

test('repeated form submission makes one admission request and preserves input on failure', async ({ page }) => {
  let admissions = 0;
  let release!: () => void;
  const admitted = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/runs', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    admissions++;
    await admitted;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Admission unavailable. Please retry.' }) });
  });
  await page.goto('/');
  await page.locator('#objective').fill('Explain local volcanic hazards');
  await page.locator('form').evaluate(form => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole('button', { name: /Preparing research/ })).toBeDisabled();
  release();
  await expect(page.getByRole('alert')).toContainText('Admission unavailable');
  expect(admissions).toBe(1);
  await expect(page.locator('#objective')).toHaveValue('Explain local volcanic hazards');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
});

test('one Start automatically completes and preserves its final graph', async ({ page }) => {
  await page.goto('/');
  await useDemoGtm(page);
  await page.locator('#min-companies').fill('5');
  await page.getByText('Discovery saturation', { exact: true }).click();
  await page.locator('#saturation').fill('0');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.status.consensus').first()).toHaveText('Completed', { timeout: 25000 });
  await expect(page.getByRole('button', { name: 'Continue research' })).toBeVisible();
  await expect(page.locator('.graph-panel canvas').first()).toBeVisible();
  const runs = await (await page.request.get('/api/runs')).json();
  const run = runs[0];
  expect(run.outcome).toBe('consensus');
  expect(run.finishedAt).toBeTruthy();
  const checkpoint = await (await page.request.get(`/api/runs/${run.id}/snapshot`)).json();
  expect(checkpoint.nodes.length).toBeGreaterThan(0);
  expect(checkpoint.agents.every((agent: { status: string }) => agent.status === 'done')).toBeTruthy();
  const duplicate = await page.request.post(`/api/runs/${run.id}/execute`, { data: {} });
  expect(duplicate.status()).toBe(409);
  const after = await (await page.request.get(`/api/runs/${run.id}/snapshot`)).json();
  expect(after).toEqual(checkpoint);
});


test('a new task can reuse the same completed brief without reopening the previous run', async ({ page }) => {
  await page.goto('/');
  const ids: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await page.getByRole('button', { name: 'New research', exact: true }).click();
    await page.locator('#objective').fill('Explain local volcanic hazards');
    const admission = page.waitForResponse(response => response.url().endsWith('/api/runs') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    const run = await (await admission).json();
    ids.push(run.id);
    await expect(page.getByRole('button', { name: 'Continue research' })).toBeVisible({ timeout: 25000 });
  }
  expect(ids[0]).not.toBe(ids[1]);
});

import type { Page } from '@playwright/test';

export async function useDemoGtm(page: Page) {
  await page.locator('.task-advanced > summary').click();
  await page.getByRole('button', { name: 'Go-to-market' }).click();
}

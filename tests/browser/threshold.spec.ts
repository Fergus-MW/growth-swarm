import { test, expect } from '@playwright/test';
import { useDemoGtm } from './helpers';

test('completion threshold supports keyboard percentages and persists the same vote boundary',async({page})=>{
  await page.goto('/');
  await useDemoGtm(page);
  const slider=page.getByRole('slider',{name:'Completion threshold',exact:true});
  await expect(slider).toHaveAttribute('min','1');
  await slider.focus();
  await slider.press('Home');
  await expect(slider).toHaveValue('1');
  await slider.press('ArrowRight');
  await expect(slider).toHaveValue('2');
  await slider.press('End');
  await expect(slider).toHaveValue('100');
  await slider.press('Home');
  for(let i=0;i<6;i++)await slider.press('ArrowRight');
  await expect(page.locator('output[for="threshold"]')).toHaveText('7%');
  await page.locator('#swarm').focus();
  await page.locator('#swarm').press('End');
  await expect(page.getByText(/7 of 100 agents must agree/)).toBeVisible();
  const created=page.waitForResponse(response=>response.url().endsWith('/api/runs')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Start'}).click();
  const run=await (await created).json();
  expect(run.config.threshold).toBe(.07);
  expect(run.config.swarmSize).toBe(100);
  await expect(page.getByRole('button',{name:'Continue research'})).toBeVisible({timeout:25000});
  await page.getByRole('button',{name:'Continue research'}).click();
  await expect(slider).toHaveValue('7');
});

test('completion threshold stays aligned with its criteria field on a small screen',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  const slider=page.getByRole('slider',{name:'Completion threshold',exact:true});
  await expect(slider).toBeVisible();
  const range=await slider.boundingBox();
  const criteria=await page.locator('#criteria').boundingBox();
  expect(range?.x).toBe(criteria?.x);
  expect(range?.width).toBe(criteria?.width);
  expect(range!.y).toBeGreaterThan(criteria!.y+criteria!.height);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
});

test('a fractional saved threshold is normalized to the displayed whole percentage before launch',async({page})=>{
  await page.route('**/api/bootstrap',async route=>{
    const response=await route.fetch();
    const bootstrap=await response.json();
    bootstrap.defaults.threshold=.071;
    await route.fulfill({response,json:bootstrap});
  });
  await page.goto('/');
  await page.locator('#objective').fill('Summarize volcanic hazards.');
  await expect(page.getByRole('slider',{name:'Completion threshold',exact:true})).toHaveValue('7');
  const created=page.waitForResponse(response=>response.url().endsWith('/api/runs')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Start'}).click();
  const run=await (await created).json();
  expect(run.config.threshold).toBe(.07);
});

import { test, expect } from '@playwright/test';

test('desktop: launch, inspect source evidence, explore, download and continue',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'What are we researching?'})).toBeVisible();
 await expect(page.getByText('14 / 20 votes',{exact:true})).toBeVisible();
 await page.locator('#min-companies').fill('5');
 await page.getByText('Discovery saturation',{exact:true}).click();
 await page.locator('#saturation').fill('0');
 await page.screenshot({path:'test-results/setup-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Launch research'}).click();
 await expect(page.getByRole('button',{name:'Continue research'})).toBeVisible({timeout:25000});
 await expect(page.locator('.status.consensus').first()).toBeVisible();
 await page.getByRole('tab',{name:/Object table/}).click();
 await page.getByRole('button',{name:'Northstar Components',exact:true}).first().click();
 await expect(page.getByRole('heading',{name:'Typed fields'})).toBeVisible();
 await page.locator('.detail-panel').getByRole('button',{name:'[1]',exact:true}).first().click();
 await expect(page.locator('.detail-panel mark')).toBeVisible();
 await page.getByRole('tab',{name:/Source ledger/}).click();
 await expect(page.getByRole('heading',{name:'Every source call, accounted for'})).toBeVisible();
 await page.getByRole('tab',{name:/Knowledge graph/}).click();
 await page.getByRole('button',{name:'Explore',exact:true}).click();
 await expect(page.locator('.graph-panel canvas').first()).toBeVisible();
 await page.screenshot({path:'test-results/research-desktop.png',fullPage:true});
 await page.locator('.export-menu summary').click();
 const download=page.waitForEvent('download');await page.getByRole('link',{name:/Research vault/}).click();expect((await download).suggestedFilename()).toMatch(/\.zip$/);
 await page.getByRole('button',{name:'Continue research'}).click();
 await expect(page.getByRole('heading',{name:'Keep the research going.'})).toBeVisible();
 await page.getByRole('button',{name:'Start child run'}).click();
 await expect(page.getByRole('button',{name:'Continue research'})).toBeVisible({timeout:25000});
 await page.getByRole('button',{name:/Research runs/}).click();
 await expect(page.locator('.run-card')).toHaveCount(2);
 expect(errors).toEqual([]);
});

test('mobile: accessible setup and durable manual stop',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/');await expect(page.getByRole('button',{name:'Launch research'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy();
 await page.screenshot({path:'test-results/setup-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Launch research'}).click();
 await page.getByRole('button',{name:'Stop research'}).click();
 await expect(page.locator('.status.stopped_by_user').first()).toBeVisible({timeout:10000});
 await page.getByRole('tab',{name:/All agents/}).click();
 await expect(page.getByRole('heading',{name:'Every agent'})).toBeVisible();
 await page.screenshot({path:'test-results/research-mobile.png',fullPage:true});
});

test('100-agent roster stays reachable and keeps missing-voter denominator',async({page})=>{
 await page.goto('/');await page.locator('#swarm').focus();await page.locator('#swarm').press('End');
 await expect(page.getByText('70 / 100 votes',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Launch research'}).click();
 await expect(page.getByRole('button',{name:'Continue research'})).toBeVisible({timeout:25000});
 await expect(page.locator('.status.criteria_unmet').first()).toBeVisible();
 await page.getByRole('tab',{name:/All agents/}).click();
 await expect(page.locator('.trace-grid .trace-card')).toHaveCount(100);
 await expect(page.getByRole('button',{name:'Pin Agent 100',exact:true})).toBeVisible();
});

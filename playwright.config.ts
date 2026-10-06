import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1, timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium', viewport: {width:1440,height:1000}, screenshot: 'only-on-failure', trace: 'retain-on-failure', launchOptions: {args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']} },
  webServer: { command: 'npm run start:legacy', url: 'http://127.0.0.1:4173/api/bootstrap', reuseExistingServer: false, env: {PORT:'4173',DATA_DIR:mkdtempSync(join(tmpdir(),'growth-swarm-browser-')),GEMINI_API_KEY:'',TAVILY_API_KEY:''}, timeout:30_000 },
});

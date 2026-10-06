import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/lovable",
  testMatch: "**/*.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4186",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx vite --config tests/lovable/vite.config.ts",
    url: "http://127.0.0.1:4186",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});

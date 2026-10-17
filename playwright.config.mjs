import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", testMatch: "**/*.spec.mjs", fullyParallel: false, workers: 1,
  retries: 0, timeout: 90_000,
  use: { baseURL: "http://127.0.0.1:3027", viewport: {width: 375, height: 812}, trace: "retain-on-failure" },
  webServer: { command: "npm run test:e2e:serve", url: "http://127.0.0.1:3027/health", reuseExistingServer: false, timeout: 60_000 },
});

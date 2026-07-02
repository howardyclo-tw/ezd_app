import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,           // shared dev DB — serialize to keep assertions deterministic
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL: 'http://[::1]:3000',
    trace: 'on-first-retry',
    locale: 'zh-TW',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://[::1]:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

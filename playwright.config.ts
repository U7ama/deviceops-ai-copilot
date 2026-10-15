import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/web',
  timeout: 30_000,
  expect: {
    timeout: 15_000
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
    ...devices['Desktop Chrome']
  },
  reporter: [['list']],
  webServer: undefined
});

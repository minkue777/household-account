import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

const baseServer = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer!;

export default defineConfig({
  ...base,
  testDir: './e2e-performance',
  testMatch: 'scenarios.spec.ts',
  timeout: 900_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  outputDir: './test-results/performance',
  reporter: [['list'], ['./e2e-performance/reporter.ts']],
  use: { ...base.use, trace: 'off', screenshot: 'only-on-failure', video: 'off' },
  webServer: { ...baseServer, command: process.env.PERFORMANCE_USE_EXISTING_BUILD === 'true'
    ? 'node e2e-performance/performance-server.cjs'
    : 'npm run build && node e2e-performance/performance-server.cjs' },
  projects: [
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'] } },
  ],
});

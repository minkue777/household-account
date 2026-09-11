import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-pwa', workers: 1, timeout: 60000,
  outputDir: './test-results/pwa',
  reporter: [['list'], ['json', { outputFile: 'quality-pwa-e2e.json' }]],
  expect: { timeout: 15000 },
  use: { ...devices['Desktop Chrome'], channel: 'chromium', baseURL: 'http://127.0.0.1:3200', serviceWorkers: 'allow', locale: 'ko-KR', timezoneId: 'Asia/Seoul', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run start -- --hostname 127.0.0.1 --port 3200', url: 'http://127.0.0.1:3200', reuseExistingServer: false, timeout: 60000 },
});

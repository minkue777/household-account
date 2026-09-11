import { defineConfig, devices } from '@playwright/test';
import {
  E2E_EMAIL,
  E2E_PASSWORD,
  E2E_PROJECT_ID,
} from './e2e/emulator';

process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_SUITE = 'true';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = E2E_PROJECT_ID;
process.env.NEXT_PUBLIC_E2E_TEST_MODE = 'true';
process.env.NEXT_PUBLIC_E2E_TEST_EMAIL = E2E_EMAIL;
process.env.NEXT_PUBLIC_E2E_TEST_PASSWORD = E2E_PASSWORD;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 30_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'quality-e2e.json' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    actionTimeout: 30_000,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: ['ios-startup.spec.ts', 'native-quick-edit.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'ios-webkit',
      testMatch: ['ios-startup.spec.ts', 'notification-deeplink.spec.ts'],
      use: { ...devices['iPhone 13'] },
    },
  ],
  webServer: {
    command: 'npm run build && npm run start -- --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    timeout: 300_000,
  },
});

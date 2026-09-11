import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  outputDir: './test-results/native-browser',
  reporter: [['list'], ['json', { outputFile: 'quality-native-e2e.json' }]],
  webServer: { ...base.webServer!, reuseExistingServer: process.env.NATIVE_E2E_EXISTING_SERVER === 'true' },
  projects: [{ name: 'native-to-web', testMatch: 'native-quick-edit.spec.ts', use: base.projects?.[0]?.use }],
});

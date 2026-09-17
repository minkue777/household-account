import base from './playwright.performance.config';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

process.env.PERFORMANCE_PHASE_DIAGNOSTICS = 'true';
process.env.PERFORMANCE_DIAGNOSTIC = 'true';
const server = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer!;
export default defineConfig({
  ...base,
  testDir: './e2e-performance',
  testMatch: 'frame-diagnostic.spec.ts',
  reporter: [['list']],
  outputDir: resolve(__dirname, 'performance-results/linux-frame-test-results'),
  // Importing the base config sets the same public emulator/auth environment as normal E2E.
  webServer: { ...server, cwd: __dirname, command: 'npm run build && node e2e-performance/performance-server.cjs' },
  projects: base.projects?.filter(project => project.name === 'webkit-mobile'),
});

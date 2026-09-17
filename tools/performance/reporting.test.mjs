import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const web = resolve(root, 'web');
const playwright = resolve(web, 'node_modules/@playwright/test');
const temporaryRoot = resolve(web, 'performance-results');

function runReporter(scenario) {
  mkdirSync(temporaryRoot, { recursive: true });
  const directory = mkdtempSync(resolve(temporaryRoot, 'reporter-test-'));
  try {
    // The real reporter records the installed Playwright version relative to cwd.
    const metadata = resolve(directory, 'node_modules/@playwright/test');
    mkdirSync(metadata, { recursive: true });
    copyFileSync(resolve(playwright, 'package.json'), resolve(metadata, 'package.json'));
    writeFileSync(resolve(directory, 'playwright.config.cjs'), `module.exports = ${JSON.stringify({
      testDir: directory, testMatch: 'reporter.spec.ts', workers: 1, retries: 0,
      timeout: 10_000, outputDir: resolve(directory, 'test-results'),
      reporter: [[resolve(web, 'e2e-performance/reporter.ts')]],
      projects: [{ name: 'chromium-mobile' }],
    })};\n`);
    writeFileSync(resolve(directory, 'reporter.spec.ts'), `
const { test, expect } = require(${JSON.stringify(playwright)});
const { WEB_PERFORMANCE_METRICS } = require(${JSON.stringify(resolve(web, 'e2e-performance/metrics.ts'))});
test('reporter attachment contract', async ({}, testInfo) => {
  for (const metric of WEB_PERFORMANCE_METRICS) {
    for (let iteration = 0; iteration <= 7; iteration += 1) {
      if (${JSON.stringify(scenario)} === 'missing' && metric === WEB_PERFORMANCE_METRICS[0] && iteration === 7) continue;
      const sample = { project: testInfo.project.name, metric, cacheState: 'reporter-fixture',
        iteration, warmup: iteration === 0, durationMs: 50_000 + iteration };
      await testInfo.attach('performance-sample', { body: JSON.stringify(sample), contentType: 'application/json' });
    }
  }
  if (${JSON.stringify(scenario)} === 'malformed') {
    await testInfo.attach('performance-sample', { body: '{invalid', contentType: 'application/json' });
  }
  expect(${JSON.stringify(scenario)} === 'functional-failure').toBe(false);
});
`);
    const env = { ...process.env, CI: 'true', PERFORMANCE_SAMPLES: '7',
      PERFORMANCE_PROFILE: 'github-hosted-v2', PERFORMANCE_DIAGNOSTIC: 'false' };
    // These fixture runs must not append fake measurements to the real CI summary.
    delete env.GITHUB_STEP_SUMMARY;
    let exitCode = 0;
    let output;
    try {
      output = execFileSync(process.execPath, [resolve(playwright, 'cli.js'), 'test',
        '--config', resolve(directory, 'playwright.config.cjs')],
      { cwd: directory, env, encoding: 'utf8', stdio: 'pipe', timeout: 30_000 });
    } catch (error) {
      if (!Number.isInteger(error.status)) throw error;
      exitCode = error.status;
      output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
    }
    const report = JSON.parse(readFileSync(resolve(directory, 'performance-results/web.json'), 'utf8'));
    return { exitCode, report, output };
  } finally {
    const child = relative(temporaryRoot, directory);
    assert(child && !child.startsWith('..') && !isAbsolute(child), 'Only remove this test temporary directory');
    rmSync(directory, { recursive: true, force: true });
  }
}

test('real Playwright reporter reports every slow sample without failing the CLI', () => {
  const { exitCode, report, output } = runReporter('complete');
  assert.equal(exitCode, 0, output);
  assert.equal(report.status, 'reported');
  assert.equal(report.testStatus, 'passed');
  assert.equal(report.coverage.complete, true);
  assert.equal(report.coverage.metrics.length, 33);
  assert.equal(report.samples.length, 33 * 8);
  assert.equal(report.performance.exceededMetrics.length, 33);
  assert.equal(report.statistics.length, 33);
  for (const metric of report.coverage.metrics) {
    assert.deepEqual(report.samples.filter(sample => sample.metric === metric).map(sample => sample.durationMs),
      Array.from({ length: 8 }, (_, index) => 50_000 + index));
    assert.deepEqual(report.statistics.find(row => row.metric === metric).samplesMs,
      Array.from({ length: 7 }, (_, index) => 50_001 + index));
  }
});

for (const scenario of ['missing', 'malformed']) {
  test(`real Playwright reporter fails the CLI for ${scenario} attachments`, () => {
    const { exitCode, report, output } = runReporter(scenario);
    assert.equal(exitCode, 1, output);
    assert.equal(report.status, 'failed');
    assert.equal(report.testStatus, 'passed');
    assert.equal(report.coverage.complete, false);
    assert(report.coverage.errors.length > 0);
  });
}

test('real Playwright reporter preserves a functional failure with otherwise complete samples', () => {
  const { exitCode, report, output } = runReporter('functional-failure');
  assert.equal(exitCode, 1, output);
  assert.equal(report.status, 'failed');
  assert.equal(report.testStatus, 'failed');
  assert.equal(report.coverage.complete, true);
  assert.equal(report.samples.length, 33 * 8);
  assert.equal(report.failures.length, 1);
});

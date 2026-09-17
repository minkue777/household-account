import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluatePerformanceBudgets } from './budgets.mjs';
import { renderPerformanceReport } from './html-report.mjs';

function reportFor(values = Array(7).fill(350), {
  project = 'webkit-mobile', metric = 'search.change-keyword', diagnostic = false, requested = values.length,
} = {}) {
  const samples = [10000, ...values].map((durationMs, iteration) => ({
    project, metric, durationMs, iteration, warmup: iteration === 0, cacheState: 'search-window-memory', label: '검색어 변경',
  }));
  const performance = evaluatePerformanceBudgets(samples, { projects: [project], metrics: [metric],
    samplesPerMetric: requested, diagnostic, profile: 'github-hosted-v2' });
  return { status: performance.status === 'pass' ? 'passed' : performance.status === 'diagnostic' ? 'diagnostic' : 'failed',
    commit: 'a'.repeat(40), timestamp: '2026-09-17T05:00:00Z',
    environment: { cpu: 'test CPU', backend: 'local emulators' },
    coverage: { projects: [project], metrics: [metric], ...performance.coverage }, performance, samples };
}
const measuredRow = html => html.match(/<details\b[^>]*class="metric-row"[^>]*>[\s\S]*?<\/details>/)?.[0];
const attribute = (html, name) => html?.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const rowAttribute = (html, name) => attribute(measuredRow(html), name);
const executionStatus = html => attribute(html.match(/<header\b[^>]*>/)?.[0], 'data-execution-status');

test('preserves independent CI and UX chart thresholds and the evaluator verdicts', () => {
  const report = reportFor();
  const html = renderPerformanceReport(report);
  const row = measuredRow(html);
  assert.equal(executionStatus(html), 'passed');
  assert.equal(attribute(row, 'data-status'), 'pass');
  assert.equal(attribute(row, 'data-ux'), 'fail');
  for (const [name, value] of Object.entries({
    'data-median': 350, 'data-repeat': 350, 'data-max': 350,
    'data-ci-median': 400, 'data-ci-repeat': 650, 'data-ci-max': 1000,
    'data-ux-median': 300, 'data-ux-repeat': 500, 'data-ux-max': 1000,
  })) assert.equal(Number(attribute(row, name)), value, name);
  assert.match(row, /class="bar within"/);
  assert.match(row, /role="img"/);
  assert.match(row, /aria-label="[^"]*87\.5%[^"]*"/);
  assert.match(row, /aria-label="[^"]*350[^"]*400[^"]*"/);
  assert.match(row, /중앙값 초과/);
  assert.match(html, /100%/);
  assert(!/^<details[^>]*\bopen(?:[\s=>])/.test(row));
});

test('preserves historical recorded budgets instead of silently applying current configuration', () => {
  const report = reportFor();
  report.performance.results[0].budget = { ...report.performance.results[0].budget, medianMs: 777 };
  const original = JSON.stringify(report);
  assert.equal(rowAttribute(renderPerformanceReport(report), 'data-ci-median'), '777');
  assert.equal(JSON.stringify(report), original);
});

test('the reviewed search and revisit graph lines retain their stricter UX comparison', () => {
  for (const [metric, value, ciMedian, uxMedian] of [
    ['search.first', 600, 750, 500], ['search.first-open', 600, 750, 500],
    ['expense-stats.revisit', 425, 450, 400], ['asset-stats.revisit', 425, 650, 400],
  ]) {
    const html = renderPerformanceReport(reportFor(Array(7).fill(value), { metric }));
    assert.equal(rowAttribute(html, 'data-status'), 'pass');
    assert.equal(rowAttribute(html, 'data-ux'), 'fail');
    assert.equal(rowAttribute(html, 'data-ci-median'), String(ciMedian));
    assert.equal(rowAttribute(html, 'data-ux-median'), String(uxMedian));
    assert.equal(rowAttribute(html, 'data-median'), String(value));
  }
});

test('the repeat chart uses the recorded required order statistic from measured samples', () => {
  const report = reportFor([1100, 100, 1001, 100, 100, 100, 100], { metric: 'search.first' });
  let html = renderPerformanceReport(report);
  assert.equal(rowAttribute(html, 'data-repeat'), '1001');
  assert.equal(rowAttribute(html, 'data-status'), 'fail');
  assert.match(measuredRow(html), /반복 허용 시간 초과/);

  const eightSamples = reportFor([800, 100, 600, 400, 200, 700, 300, 500], { metric: 'search.first' });
  assert.equal(rowAttribute(renderPerformanceReport(eightSamples), 'data-repeat'), '700');

  // Historical reports retain their own recorded rule, rather than being reinterpreted.
  report.performance.results[0].observed.requiredWithinBudget = 7;
  const original = JSON.stringify(report);
  html = renderPerformanceReport(report);
  assert.equal(rowAttribute(html, 'data-repeat'), '1100');
  assert.equal(JSON.stringify(report), original);
});

test('rounding does not make a failed timing look equal to its passing threshold', () => {
  for (const [value, metric, ciLimit, tone] of [
    [750.04, 'search.first', 750, 'exceeded'],
    [300.04, 'search.change-keyword', 400, 'within'],
  ]) {
    const html = renderPerformanceReport(reportFor(Array(7).fill(value), { metric }));
    const row = measuredRow(html);
    assert.equal(rowAttribute(html, 'data-median'), String(value));
    assert.equal(rowAttribute(html, 'data-ci-median'), String(ciLimit));
    assert.match(row, new RegExp(`class="bar ${tone}"`));
    assert.equal(attribute(row.match(/<span class="plot"[^>]*>/)?.[0], 'aria-label').includes(String(value)), true);
    assert.equal(row.match(/<tr><th>중앙값<\/th><td>([^<]*)<\/td>/)?.[1], String(value));
  }
});

test('each independent timing failure remains visible and warmup is kept outside measured samples', () => {
  for (const [values, reason] of [
    [Array(7).fill(751), '중앙값 초과'],
    [[100, 100, 100, 100, 1001, 1001, 1001], '반복 허용 시간 초과'],
    [[100, 100, 100, 100, 100, 100, 1501], '개별 최대 시간 초과'],
  ]) {
    const html = renderPerformanceReport(reportFor(values, { metric: 'search.first' }));
    assert.equal(executionStatus(html), 'failed');
    const row = measuredRow(html);
    assert.equal(attribute(row, 'data-status'), 'fail');
    assert(row.includes(reason));
    if (reason === '개별 최대 시간 초과') {
      assert.equal(attribute(row, 'data-median'), '100');
      assert.equal(attribute(row, 'data-max'), '1501');
      assert.match(row, /class="bar within"/);
    }
    assert(!row.includes('10,000'));
    assert(!row.includes('10000'));
    assert.match(html, /준비 실행/);
    assert.match(html, /10,000/);
  }
});

test('a functional failure cannot appear as overall success even when timings passed', () => {
  const report = reportFor();
  report.status = 'failed';
  report.failures = ['합계 검증 실패'];
  const html = renderPerformanceReport(report);
  assert.equal(executionStatus(html), 'failed');
  assert.equal(rowAttribute(html, 'data-status'), 'pass');
  assert.match(html, /합계 검증 실패/);
});

test('diagnostics and incomplete coverage never become a green overall verdict', () => {
  const diagnostic = renderPerformanceReport(reportFor([100, 110, 120], { diagnostic: true }));
  assert.equal(executionStatus(diagnostic), 'diagnostic');
  assert.equal(rowAttribute(diagnostic, 'data-status'), 'diagnostic');
  assert.match(measuredRow(diagnostic), /class="bar unverified"/);
  const partial = reportFor([100, 100], { requested: 7 });
  partial.coverage.metrics.push('search.first');
  const html = renderPerformanceReport(partial);
  assert.equal(executionStatus(html), 'failed');
  assert.equal(rowAttribute(html, 'data-status'), 'invalid');
  assert.match(measuredRow(html), /class="bar unverified"/);
  assert.match(html, /Missing performance sample/);
  assert.match(html, /data-status="missing"/);
  assert.match(html, /미측정/);
});

test('escapes all report-derived HTML and attributes without embedding raw JSON or external resources', () => {
  const report = reportFor();
  const payload = '"><script>globalThis.compromised=true</script><img src="https://evil.test/">';
  report.performance.results[0].label = payload;
  report.performance.results[0].cacheState = payload;
  report.performance.results[0].project = payload;
  report.performance.results[0].reasons = [payload];
  report.performance.warmupSamples[0].label = payload;
  report.environment.cpu = payload;
  report.failures = [payload];
  report.commit = payload;
  const html = renderPerformanceReport(report, { title: payload });
  assert(!html.includes('<script>globalThis.compromised'));
  assert(!html.includes('<img src='));
  assert(html.includes('&lt;script&gt;'));
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
  assert(!/<(?:script|link)\b[^>]*(?:src|href)=/.test(html));
});

test('supports the Android native report shape and validation errors', () => {
  const report = reportFor(Array(7).fill(300), { project: 'android-emulator', metric: 'android.quick-edit.save-to-closed' });
  delete report.coverage;
  delete report.timestamp;
  report.recordedAt = '2026-09-17T06:00:00Z';
  report.environment = { device: 'emulator-5554', webView: '113.0', firebase: 'local-emulators' };
  report.host = { cpu: 'Native host CPU', platform: 'linux', osRelease: 'test' };
  report.validationErrors = ['Native schema mismatch'];
  const html = renderPerformanceReport(report);
  assert.match(html, /<title>Android 성능<\/title>/);
  assert.match(html, /Native host CPU/);
  assert.match(html, /emulator-5554/);
  assert.match(html, /2026-09-17T06:00:00Z/);
  assert.match(html, /Native schema mismatch/);
  assert.equal(executionStatus(html), 'failed');
});

test('the CLI writes a standalone report from an existing JSON and refuses to overwrite its source', () => {
  const directory = mkdtempSync(join(tmpdir(), 'household-performance-html-'));
  try {
    const input = join(directory, 'input.json');
    const output = join(directory, 'report.html');
    const cli = fileURLToPath(new URL('./html-report.mjs', import.meta.url));
    const original = JSON.stringify(reportFor());
    writeFileSync(input, original);
    execFileSync(process.execPath, [cli, input, output]);
    assert.match(readFileSync(output, 'utf8'), /^<!doctype html>/);
    assert.equal(spawnSync(process.execPath, [cli, input, input]).status, 1);
    assert.equal(readFileSync(input, 'utf8'), original);
    assert.throws(() => renderPerformanceReport({}), /판정 결과/);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  }
});

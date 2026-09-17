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
const card = (html, title) => html.match(new RegExp(`<article><h2>${title}</h2>([\\s\\S]*?)</article>`))?.[1];
const measuredRow = html => html.match(/<tr data-project=[\s\S]*?<\/tr>/)?.[0];

test('shows applied CI and UX thresholds separately with the evaluator verdicts', () => {
  const report = reportFor();
  const html = renderPerformanceReport(report);
  assert.match(card(html, 'CI 기준 판정'), /badge pass/);
  assert.match(card(html, '공통 UX 목표 비교'), /badge fail/);
  const row = measuredRow(html);
  assert.match(row, /data-status="pass" data-ux="fail"/);
  assert.match(row, /<strong>350<\/strong>\s*<span class="limit">기준 ≤ 400 ms/);
  assert.match(row, /7 \/ 7회/);
  assert.match(row, /최소 6회 ≤ 650 ms/);
  assert.match(row, /기준 ≤ 1,000 ms/);
  assert.match(row, /<dt>중앙값<\/dt><dd>≤ 300 ms/);
  assert.match(row, /중앙값 초과/);
  assert.match(html, /이 실행의 JSON에 기록된 값/);
});

test('preserves historical recorded budgets instead of silently applying current configuration', () => {
  const report = reportFor();
  report.performance.results[0].budget = { ...report.performance.results[0].budget, medianMs: 777 };
  const original = JSON.stringify(report);
  assert.match(measuredRow(renderPerformanceReport(report)), /기준 ≤ 777 ms/);
  assert.equal(JSON.stringify(report), original);
});

test('rounding does not make a failed timing look equal to its passing threshold', () => {
  const html = renderPerformanceReport(reportFor(Array(7).fill(500.04), { metric: 'search.first' }));
  assert.match(measuredRow(html), /<strong>500\.04<\/strong>\s*<span class="limit">기준 ≤ 500 ms/);
});

test('each independent timing failure remains visible and warmup is kept outside measured samples', () => {
  for (const [values, reason] of [
    [Array(7).fill(501), '중앙값 초과'],
    [[100, 100, 100, 100, 801, 801, 801], '반복 허용 시간 초과'],
    [[100, 100, 100, 100, 100, 100, 1501], '개별 최대 시간 초과'],
  ]) {
    const html = renderPerformanceReport(reportFor(values, { metric: 'search.first' }));
    assert.match(card(html, 'CI 기준 판정'), /badge fail/);
    const row = measuredRow(html);
    assert(row.includes(reason));
    assert.match(row, /class="timing exceeded"/);
    assert(!row.includes('10,000'));
    assert.match(html, /준비 실행 1개 · 본 판정에서 제외/);
    assert.match(html, />10,000<\/td>/);
  }
});

test('a functional failure cannot appear as overall success even when timings passed', () => {
  const report = reportFor();
  report.status = 'failed';
  report.failures = ['합계 검증 실패'];
  const html = renderPerformanceReport(report);
  assert.match(card(html, '전체 실행'), /badge fail/);
  assert.match(card(html, 'CI 기준 판정'), /badge pass/);
  assert.match(html, /합계 검증 실패/);
});

test('diagnostics and incomplete coverage never become a green overall verdict', () => {
  const diagnostic = renderPerformanceReport(reportFor([100, 110, 120], { diagnostic: true }));
  assert.match(card(diagnostic, '전체 실행'), /badge neutral/);
  assert.match(diagnostic, /정식 PASS를 부여하지 않습니다/);
  const partial = reportFor([100, 100], { requested: 7 });
  partial.coverage.metrics.push('search.first');
  const html = renderPerformanceReport(partial);
  assert.match(card(html, '전체 실행'), /badge fail/);
  assert.match(html, /불완전/);
  assert.match(html, /Missing performance sample/);
  assert.match(html, /data-status="missing"/);
  assert.match(html, /기준 기록 없음/);
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
  assert.match(html, /<title>Android 성능 보고서<\/title>/);
  assert.match(html, /Native host CPU/);
  assert.match(html, /emulator-5554/);
  assert.match(html, /2026-09-17T06:00:00Z/);
  assert.match(html, /Native schema mismatch/);
  assert.match(card(html, '전체 실행'), /badge fail/);
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

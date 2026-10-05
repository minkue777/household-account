import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { budgetMarkdown, evaluatePerformanceBudgets, PERFORMANCE_BUDGETS, PERFORMANCE_PROFILES, PERFORMANCE_POLICY_VERSION } from './budgets.mjs';

const specification = { projects: ['chromium-mobile'], metrics: ['ledger.open-detail'], samplesPerMetric: 7 };
function samples(values = Array(7).fill(100), options = {}) {
  const { project = 'chromium-mobile', metric = 'ledger.open-detail', warmup = true } = options;
  return [...(warmup ? [{ iteration: 0, warmup: true, durationMs: 10_000 }] : []),
    ...values.map((durationMs, index) => ({ iteration: index + 1, warmup: false, durationMs }))]
    .map(sample => ({ project, metric, cacheState: 'fixture-memory', ...sample }));
}
const evaluate = (values, overrides = {}) => evaluatePerformanceBudgets(samples(values), { ...specification, ...overrides });

test('report-only preserves every slow observation without a timing pass/fail for Web and Android', () => {
  for (const [project, metric] of [
    ['chromium-mobile', 'ledger.open-detail'], ['webkit-mobile', 'ledger.open-detail'],
    ['android-emulator', 'android.quick-edit.notification-to-ready'],
  ]) {
    const values = [50_001, 50_002, 50_003, 50_004, 50_005, 50_006, 50_007];
    const result = evaluatePerformanceBudgets(samples(values, { project, metric }), {
      projects: [project], metrics: [metric], samplesPerMetric: 7,
      ci: true, profile: 'github-hosted-v2',
    });
    assert.equal(result.mode, 'report-only');
    assert.equal(result.status, 'reported');
    assert.equal(result.uxStatus, 'reported');
    assert.equal(result.results[0].status, 'reported');
    assert.equal(result.results[0].ux.status, 'reported');
    assert.equal(result.results[0].withinTimeBudget, false);
    assert.deepEqual(result.results[0].reasons, ['median-exceeded', 'six-of-seven-exceeded', 'single-sample-maximum-exceeded']);
    assert.deepEqual(result.statistics[0].samplesMs, values);
    assert.deepEqual(result.exceededMetrics, [`${project}/${metric}`]);
    assert.equal(result.coverage.complete, true);
    assert.deepEqual(result.errors, []);
    const markdown = budgetMarkdown(result);
    assert.match(markdown, /리포트 전용/);
    assert.match(markdown, /기준 초과/);
    assert.doesNotMatch(markdown, /\bPASS\b|\bFAIL\b/);
  }
  const fast = evaluate(Array(7).fill(1), {});
  assert.equal(fast.status, 'reported');
  assert.match(budgetMarkdown(fast), /기준 이내/);
});

test('report-only still rejects missing, duplicate, malformed, short and invalidly configured measurements', () => {
  const input = samples(Array(7).fill(50_000));
  for (const invalid of [[], input.slice(0, -1), [...input, input[1]],
    input.map((sample, index) => index === 1 ? { ...sample, durationMs: Number.NaN } : sample)]) {
    const result = evaluatePerformanceBudgets(invalid, { ...specification, ci: true });
    assert.equal(result.status, 'fail');
    assert.equal(result.coverage.complete, false);
    assert(result.errors.length > 0);
    assert(result.results.every(row => row.status === 'invalid'));
  }
  for (const overrides of [
    { samplesPerMetric: 6 }, { profile: 'unknown' }, { mode: 'gate' }, { mode: 'diagnostic', ci: true },
  ]) {
    const result = evaluate(Array(7).fill(50_000), { ...overrides });
    assert.equal(result.status, 'fail');
    assert(result.errors.length > 0);
  }
});

test('missing metrics, missing observations, and duplicates fail instead of passing a partial baseline', () => {
  const complete = samples();
  for (const changed of [complete.slice(0, -1), [...complete, complete[1]], []]) {
    const result = evaluatePerformanceBudgets(changed, specification);
    assert.equal(result.status, 'fail');
    assert.equal(result.coverage.complete, false);
  }
  const missingMetric = evaluate(Array(7).fill(50), { metrics: ['ledger.open-detail', 'ledger.select-day'] });
  assert.equal(missingMetric.status, 'fail');
  assert(missingMetric.coverage.errors.some(error => error.includes('ledger.select-day')));
});

test('unknown declared and undeclared metrics including inherited property names fail closed', () => {
  for (const metric of ['unbudgeted.feature', 'toString', '__proto__']) {
    const result = evaluatePerformanceBudgets(samples(Array(7).fill(20), { metric }), { ...specification, metrics: [metric] });
    assert.equal(result.status, 'fail');
    assert(result.errors.some(error => error.includes('Missing performance budget')));
    const undeclared = evaluatePerformanceBudgets([...samples(), ...samples([20], { metric })], specification);
    assert.equal(undeclared.status, 'fail');
  }
});

test('a known metric in an unbudgeted browser or platform requires a known comparison', () => {
  const project = 'new-browser';
  const result = evaluatePerformanceBudgets(samples(Array(7).fill(20), { project }), { ...specification, projects: [project] });
  assert.equal(result.status, 'fail');
  assert(result.errors.some(error => error.includes('No performance budget for path')));
});

test('NaN, Infinity, negative intervals, malformed samples and invalid warmups all fail', () => {
  for (const durationMs of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    for (const index of [0, 1]) {
      const input = samples();
      input[index].durationMs = durationMs;
      const result = evaluatePerformanceBudgets(input, specification);
      assert.equal(result.status, 'fail');
      assert.equal(result.coverage.complete, false);
    }
  }
  assert.equal(evaluatePerformanceBudgets(null, specification).status, 'fail');
  const malformed = samples();
  malformed[1] = null;
  assert.equal(evaluatePerformanceBudgets(malformed, specification).status, 'fail');
});

test('slow samples cannot be reclassified as warmup or moved to another cache group', () => {
  const input = samples();
  input[7] = { ...input[7], durationMs: 50_000, warmup: true };
  assert.equal(evaluatePerformanceBudgets(input, specification).status, 'fail');
  input[7] = { ...input[7], warmup: false, cacheState: 'different-cache' };
  assert.equal(evaluatePerformanceBudgets(input, specification).status, 'fail');
});

test('WebView cleanup diagnostics are never substituted for production lifecycle measurements', () => {
  const metric = 'android.home.isolated-activity-complete';
  const input = samples(Array(7).fill(1000), { metric, project: 'android-emulator', warmup: false });
  const spec = { projects: ['android-emulator'], metrics: [metric], samplesPerMetric: 7, warmupMetrics: [] };
  assert.equal(evaluatePerformanceBudgets(input, spec).status, 'fail');
  assert.equal(evaluatePerformanceBudgets(input, { ...spec, mode: 'diagnostic' }).status, 'diagnostic');
});

test('the independent Web coverage contract has explicit budgets for every path', () => {
  const source = readFileSync(new URL('../../web/e2e-performance/metrics.ts', import.meta.url), 'utf8');
  const metrics = [...source.matchAll(/^\s+'([^']+)',?$/gm)].map(match => match[1]);
  assert(metrics.length >= 32);
  for (const metric of metrics) assert(Object.hasOwn(PERFORMANCE_BUDGETS, metric), `Missing budget: ${metric}`);
});

test('unknown or malformed profiles cannot silently fall back to a permissive limit', () => {
  for (const profile of ['', 'unknown', 'toString', '__proto__', null, 7]) {
    const result = evaluate(Array(7).fill(10), { profile });
    assert.equal(result.status, 'fail');
    assert(result.errors.some(error => error.includes('Unknown performance profile')));
    assert.equal(result.results[0].budget, null);
  }
});


test('reference comparisons preserve all boundary observations without issuing verdicts', () => {
  for (const [values, reasons] of [
    [[200, 200, 200, 200, 350, 350, 1000], []],
    [Array(7).fill(201), ['median-exceeded']],
    [[0, 0, 0, 0, 351, 351, 351], ['six-of-seven-exceeded']],
    [[0, 0, 0, 0, 0, 0, 1001], ['single-sample-maximum-exceeded']],
  ]) {
    const before = [...values];
    const result = evaluate(values);
    assert.equal(result.status, 'reported');
    assert.deepEqual(result.results[0].reasons, reasons);
    assert.deepEqual(result.statistics[0].samplesMs, before);
    assert.equal(result.warmupSamples[0].durationMs, 10_000);
    assert.equal(result.firstExecutionPerformanceValidated, false);
  }
  for (const [n, required] of [[7, 6], [8, 7], [14, 12], [30, 26]]) {
    const result = evaluate(Array(n).fill(100), { samplesPerMetric: n });
    assert.equal(result.results[0].observed.requiredWithinBudget, required);
  }
});

test('local diagnostics permit short complete measurements, never incomplete CI runs', () => {
  for (const count of [1, 6]) {
    assert.equal(evaluate(Array(count).fill(50_000), { samplesPerMetric: count }).status, 'fail');
    const result = evaluate(Array(count).fill(50_000), { samplesPerMetric: count, mode: 'diagnostic' });
    assert.equal(result.status, 'diagnostic');
    assert.equal(result.results[0].status, 'diagnostic');
    assert(result.exceededMetrics.length > 0);
    assert.equal(evaluate(Array(count).fill(1), { samplesPerMetric: count, mode: 'diagnostic', ci: true }).status, 'fail');
  }
});

test('hosted comparison and UX comparison remain independent and source samples stay immutable', () => {
  const project = 'webkit-mobile';
  const input = samples(Array(7).fill(480), { project });
  const before = structuredClone(input);
  const result = evaluatePerformanceBudgets(input, { ...specification, projects: [project], profile: 'github-hosted-v2', ci: true });
  assert.equal(result.results[0].budget.medianMs, 600);
  assert.equal(result.results[0].ux.budget.medianMs, 200);
  assert.equal(result.results[0].withinTimeBudget, true);
  assert.equal(result.results[0].ux.withinTimeBudget, false);
  assert.equal(result.status, 'reported');
  assert.deepEqual(input, before);
  assert.deepEqual(result.uxExceededMetrics, ['webkit-mobile/ledger.open-detail']);
  assert.deepEqual(result.exceededMetrics, []);
  assert.match(budgetMarkdown(result), /기준 초과/);
  assert.deepEqual(Object.keys(PERFORMANCE_PROFILES), ['ux-v2', 'github-hosted-v2']);
  assert.equal(PERFORMANCE_POLICY_VERSION, 'household-performance-budgets.v2');
});

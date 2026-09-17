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

test('passes at all three absolute boundaries and preserves raw warmup separately', () => {
  const result = evaluate([200, 200, 200, 200, 350, 350, 1000]);
  assert.equal(result.status, 'pass');
  assert.equal(result.results[0].observed.withinBudget, 6);
  assert.equal(result.warmupSamples[0].durationMs, 10_000);
  assert.equal(result.statistics[0].maxMs, 1000);
  assert.equal(result.firstExecutionPerformanceValidated, false);
});

test('does not penalize a relative slowdown while both runs remain within absolute budgets', () => {
  assert.equal(evaluate(Array(7).fill(30)).status, 'pass');
  assert.equal(evaluate(Array(7).fill(190)).status, 'pass');
});

test('median, repeated tail, and one extreme observation independently fail the gate', () => {
  for (const [values, reason] of [
    [Array(7).fill(201), 'median-exceeded'],
    [[0, 0, 0, 0, 351, 351, 351], 'six-of-seven-exceeded'],
    [[0, 0, 0, 0, 0, 0, 1001], 'single-sample-maximum-exceeded'],
  ]) {
    const result = evaluate(values);
    assert.equal(result.status, 'fail');
    assert.deepEqual(result.results[0].reasons, [reason]);
    assert.deepEqual(result.statistics[0].samplesMs, values);
  }
});

test('Android home cannot hide the 50.7 second pause behind a good median', () => {
  const metric = 'android.home.activity-reopen-complete';
  const result = evaluatePerformanceBudgets(samples([1112.6, 1051.6, 1159.5, 1461, 2170.9, 50666.6, 2752],
    { metric, project: 'android-emulator', warmup: false }),
  { projects: ['android-emulator'], metrics: [metric], samplesPerMetric: 7, warmupMetrics: [] });
  assert.equal(result.status, 'fail');
  assert.equal(result.results[0].observed.medianMs, 1461);
  assert.deepEqual(result.results[0].reasons, ['single-sample-maximum-exceeded']);
  assert.equal(result.statistics[0].n, 7);
});

test('larger explicit batches use ceil(n * 6 / 7), never an estimated p95', () => {
  for (const [n, required] of [[7, 6], [8, 7], [14, 12], [30, 26]]) {
    const result = evaluate([...Array(required).fill(100), ...Array(n - required).fill(900)], { samplesPerMetric: n });
    assert.equal(result.status, 'pass');
    assert.equal(result.results[0].observed.requiredWithinBudget, required);
  }
});

test('short local runs require explicit diagnostic mode and never report PASS', () => {
  for (const count of [1, 6]) {
    const values = Array(count).fill(50);
    const gate = evaluate(values, { samplesPerMetric: count });
    assert.equal(gate.status, 'fail');
    assert(gate.errors.some(error => error.includes('at least 7')));
    assert.equal(gate.results[0].status, 'invalid');
    const diagnostic = evaluate(values, { samplesPerMetric: count, diagnostic: true });
    assert.equal(diagnostic.status, 'diagnostic');
    assert.equal(diagnostic.results[0].status, 'diagnostic');
    assert(!budgetMarkdown(diagnostic).includes('| PASS |'));
  }
});

test('explicit diagnostics retain budget exceedances without granting a performance pass', () => {
  const diagnostic = evaluate([4000], { samplesPerMetric: 1, diagnostic: true });
  assert.equal(diagnostic.status, 'diagnostic');
  assert.equal(diagnostic.results[0].status, 'fail');
  assert.deepEqual(diagnostic.exceededMetrics, ['chromium-mobile/ledger.open-detail']);
  assert.equal(diagnostic.statistics[0].maxMs, 4000);
});

test('CI cannot bypass the performance gate by enabling diagnostics', () => {
  const result = evaluate(Array(7).fill(100), { diagnostic: true, ci: true });
  assert.equal(result.status, 'fail');
  assert(result.errors.includes('Diagnostic performance mode is not allowed in CI'));
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

test('a known metric in an unbudgeted browser or platform cannot receive PASS', () => {
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

test('WebView cleanup diagnostics are never substituted for production lifecycle PASS', () => {
  const metric = 'android.home.isolated-activity-complete';
  const input = samples(Array(7).fill(1000), { metric, project: 'android-emulator', warmup: false });
  const spec = { projects: ['android-emulator'], metrics: [metric], samplesPerMetric: 7, warmupMetrics: [] };
  assert.equal(evaluatePerformanceBudgets(input, spec).status, 'fail');
  assert.equal(evaluatePerformanceBudgets(input, { ...spec, diagnostic: true }).status, 'diagnostic');
});

test('the independent Web coverage contract has explicit budgets for every path', () => {
  const source = readFileSync(new URL('../../web/e2e-performance/metrics.ts', import.meta.url), 'utf8');
  const metrics = [...source.matchAll(/^\s+'([^']+)',?$/gm)].map(match => match[1]);
  assert(metrics.length >= 32);
  for (const metric of metrics) assert(Object.hasOwn(PERFORMANCE_BUDGETS, metric), `Missing budget: ${metric}`);
});

test('first search from modal open includes the same budget as typing into an open search', () => {
  assert.deepEqual(PERFORMANCE_BUDGETS['search.first-open'], PERFORMANCE_BUDGETS['search.first']);
  const metric = 'search.first-open';
  const result = evaluatePerformanceBudgets(samples(Array(7).fill(501), { metric }), { ...specification, metrics: [metric] });
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.results[0].reasons, ['median-exceeded']);
});

test('Markdown exposes failed thresholds and a slow warmup without changing the raw samples', () => {
  const input = samples([0, 0, 0, 0, 0, 0, 1001]);
  const before = structuredClone(input);
  const result = evaluatePerformanceBudgets(input, specification);
  const markdown = budgetMarkdown(result);
  assert(markdown.includes('**FAIL**'));
  assert(markdown.includes('single-sample-maximum-exceeded'));
  assert(markdown.includes('10000.0'));
  assert(markdown.includes('최초 실행'));
  assert.deepEqual(input, before);
});

test('a selected hosted profile can pass while preserving the original UX budget and failure', () => {
  const project = 'webkit-mobile';
  const input = samples([481, 480, 480, 473, 481, 488, 482], { project });
  const originalUxBudgets = structuredClone(PERFORMANCE_BUDGETS);
  const result = evaluatePerformanceBudgets(input, { ...specification, projects: [project], profile: 'github-hosted-v2', ci: true });
  assert.equal(result.profile, 'github-hosted-v2');
  assert.equal(result.status, 'pass');
  assert.equal(result.uxStatus, 'fail');
  assert.equal(result.results[0].budget.medianMs, 600);
  assert.equal(result.results[0].status, 'pass');
  assert.equal(result.results[0].ux.budget.medianMs, 200);
  assert.equal(result.results[0].ux.status, 'fail');
  assert.deepEqual(result.uxExceededMetrics, ['webkit-mobile/ledger.open-detail']);
  assert.deepEqual(result.exceededMetrics, []);
  assert.deepEqual(PERFORMANCE_BUDGETS, originalUxBudgets);
  assert.deepEqual(result.statistics[0].samplesMs, input.filter(sample => !sample.warmup).map(sample => sample.durationMs));
  const markdown = budgetMarkdown(result);
  assert(markdown.includes('적용 프로필: github-hosted-v2'));
  assert(markdown.includes('UX 기준 비교: **FAIL**'));
  assert(markdown.includes('| PASS | FAIL'));
});

test('local and CI executions default to strict UX unless a profile is explicitly selected', () => {
  const project = 'webkit-mobile';
  const input = samples(Array(7).fill(480), { project });
  for (const ci of [false, true]) {
    const result = evaluatePerformanceBudgets(input, { ...specification, projects: [project], ci });
    assert.equal(result.profile, 'ux-v2');
    assert.equal(result.status, 'fail');
    assert.equal(result.uxStatus, 'fail');
    assert.deepEqual(result.results[0].budget, result.results[0].ux.budget);
  }
});

test('unknown or malformed profiles cannot silently fall back to a permissive limit', () => {
  for (const profile of ['', 'unknown', 'toString', '__proto__', null, 7]) {
    const result = evaluate(Array(7).fill(10), { profile });
    assert.equal(result.status, 'fail');
    assert(result.errors.some(error => error.includes('Unknown performance profile')));
    assert.equal(result.results[0].budget, null);
  }
});

test('the hosted profile leaves Chromium, initial search, statistics, and unlisted paths unchanged', () => {
  const profile = 'github-hosted-v2';
  assert.equal(evaluate(Array(7).fill(480), { profile }).status, 'fail');
  for (const [metric, durationMs] of [
    ['search.first', 501], ['search.first-open', 501], ['expense-stats.first', 801],
    ['asset-stats.first', 801], ['asset-stats.period-all', 401], ['ledger.save-memo.server-confirmed', 501],
  ]) {
    const project = 'webkit-mobile';
    const result = evaluatePerformanceBudgets(samples(Array(7).fill(durationMs), { project, metric }),
      { projects: [project], metrics: [metric], samplesPerMetric: 7, profile });
    assert.equal(result.status, 'fail', metric);
    assert.equal(result.results[0].budgetSource, 'ux-v2', metric);
    assert.deepEqual(result.results[0].budget, result.results[0].ux.budget, metric);
  }
});

test('hosted keyword and next-page allowances apply only to those fast WebKit UI paths', () => {
  for (const metric of ['search.next-page', 'search.change-keyword']) {
    const project = 'webkit-mobile';
    const input = samples(Array(7).fill(348), { project, metric });
    const spec = { projects: [project], metrics: [metric], samplesPerMetric: 7, profile: 'github-hosted-v2' };
    const result = evaluatePerformanceBudgets(input, spec);
    assert.equal(result.status, 'pass');
    assert.equal(result.uxStatus, 'fail');
    assert.equal(result.results[0].budget.medianMs, 400);
    assert.equal(result.results[0].budget.sixOfSevenMs, 650);
    assert.equal(result.results[0].budget.maxMs, 1000);
    assert.equal(evaluatePerformanceBudgets(samples(Array(7).fill(401), { project, metric }), spec).status, 'fail');
  }
});

test('hosted Android allowances retain both verdicts and still reject one catastrophic pause', () => {
  const project = 'android-emulator';
  const metric = 'android.home.activity-reopen-complete';
  const input = samples([3005, 3060, 3474, 3355, 3397, 3475, 3276], { project, metric, warmup: false });
  const spec = { projects: [project], metrics: [metric], samplesPerMetric: 7, warmupMetrics: [], profile: 'github-hosted-v2' };
  const result = evaluatePerformanceBudgets(input, spec);
  assert.equal(result.status, 'pass');
  assert.equal(result.uxStatus, 'fail');
  input[0].durationMs = 50_667;
  const paused = evaluatePerformanceBudgets(input, spec);
  assert.equal(paused.status, 'fail');
  assert.equal(paused.uxStatus, 'fail');
  assert(paused.results[0].reasons.includes('single-sample-maximum-exceeded'));
  assert.equal(paused.statistics[0].maxMs, 50_667);
});

test('hosted profile limits are explicit, immutable, and cannot override an unreviewed metric', () => {
  assert(Object.isFrozen(PERFORMANCE_BUDGETS));
  for (const profile of Object.values(PERFORMANCE_PROFILES)) {
    assert(Object.isFrozen(profile));
    for (const [project, overrides] of Object.entries(profile.overrides)) {
      assert(Object.isFrozen(overrides));
      for (const [metric, limit] of Object.entries(overrides)) {
        assert(Object.hasOwn(PERFORMANCE_BUDGETS, metric));
        assert(PERFORMANCE_BUDGETS[metric].projects.includes(project));
        assert(limit.projects.includes(project));
        assert(Object.isFrozen(limit));
        assert(limit.maxMs <= 5000, `${project}/${metric} must not excuse prolonged pauses`);
      }
    }
  }
  assert.equal(evaluate(Array(7).fill(20), { profile: 'github-hosted-v2', diagnostic: true, ci: true }).status, 'fail');
});

test('version two never evaluates new stricter budgets under a historical profile name', () => {
  assert.equal(PERFORMANCE_POLICY_VERSION, 'household-performance-budgets.v2');
  assert.deepEqual(Object.keys(PERFORMANCE_PROFILES), ['ux-v2', 'github-hosted-v2']);
  assert.equal(evaluate(Array(7).fill(10)).profile, 'ux-v2');
  for (const profile of ['ux-v1', 'github-hosted-v1']) {
    const result = evaluate(Array(7).fill(10), { profile });
    assert.equal(result.status, 'fail');
    assert(result.errors.some(error => error.includes('Unknown performance profile')));
  }
});

test('search and statistics enforce the reviewed v2 boundaries in both UX and hosted execution', () => {
  const groups = [
    { metrics: ['search.first', 'search.first-open'], median: 500, repeated: 800, maximum: 1500 },
    { metrics: ['expense-stats.first', 'asset-stats.first'], median: 800, repeated: 1200, maximum: 2000 },
    { metrics: ['expense-stats.period-3', 'expense-stats.period-6', 'expense-stats.period-12', 'expense-stats.revisit',
      'asset-stats.period-3', 'asset-stats.period-6', 'asset-stats.period-12', 'asset-stats.period-all', 'asset-stats.revisit'],
    median: 400, repeated: 600, maximum: 1200 },
  ];
  for (const { metrics, median, repeated, maximum } of groups) for (const metric of metrics) {
    for (const project of ['chromium-mobile', 'webkit-mobile']) for (const profile of ['ux-v2', 'github-hosted-v2']) {
      const spec = { projects: [project], metrics: [metric], samplesPerMetric: 7, profile };
      const boundary = evaluatePerformanceBudgets(samples([median, median, median, median, repeated, repeated, maximum], { project, metric }), spec);
      assert.equal(boundary.status, 'pass', `${project}/${metric}/${profile}`);
      assert.equal(boundary.uxStatus, 'pass');
      for (const values of [Array(7).fill(median + 1), [0, 0, 0, 0, repeated + 1, repeated + 1, repeated + 1],
        [0, 0, 0, 0, 0, 0, maximum + 1]]) {
        const failed = evaluatePerformanceBudgets(samples(values, { project, metric }), spec);
        assert.equal(failed.status, 'fail', `${project}/${metric}/${profile}`);
        assert.equal(failed.uxStatus, 'fail');
      }
    }
  }
});

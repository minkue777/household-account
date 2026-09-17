import { summarizeSamples, validateSampleCoverage } from './statistics.mjs';

export const PERFORMANCE_POLICY_VERSION = 'household-performance-budgets.v2';
export const MINIMUM_GATE_SAMPLES = 7;
const webProjects = ['chromium-mobile', 'webkit-mobile'];
const androidProjects = ['android-emulator'];
const budget = (medianMs, sixOfSevenMs, maxMs, projects = webProjects, diagnosticOnly = false) =>
  Object.freeze({ medianMs, sixOfSevenMs, maxMs, projects: Object.freeze([...projects]), diagnosticOnly });

// Explicit IDs are intentional: adding a measured path requires a reviewed budget.
// These are absolute UX budgets, not a percentage of the previous run's timings.
export const PERFORMANCE_BUDGETS = Object.freeze({
  'home.fresh-context': budget(1000, 1500, 5000),
  'home.relaunch': budget(1000, 1500, 5000),
  'ledger.select-day': budget(200, 350, 1000),
  'ledger.open-detail': budget(200, 350, 1000),
  'ledger.save-memo': budget(200, 350, 1000),
  'ledger.save-memo.server-confirmed': budget(500, 1000, 5000),
  'ledger.save-category': budget(200, 350, 1000),
  'ledger.save-category.server-confirmed': budget(500, 1000, 5000),
  'ledger.previous-month': budget(400, 700, 5000),
  'ledger.return-month': budget(400, 700, 5000),
  'search.first': budget(500, 800, 1500),
  'search.first-open': budget(500, 800, 1500),
  'search.next-page': budget(300, 500, 1000),
  'search.change-keyword': budget(300, 500, 1000),
  'expense-stats.first': budget(800, 1200, 2000),
  'expense-stats.period-3': budget(400, 600, 1200),
  'expense-stats.period-6': budget(400, 600, 1200),
  'expense-stats.period-12': budget(400, 600, 1200),
  'expense-stats.revisit': budget(400, 600, 1200),
  'assets.first': budget(500, 800, 5000),
  'assets.account-detail': budget(200, 350, 1000),
  'ledger.return-from-assets': budget(400, 700, 5000),
  'assets.revisit': budget(400, 700, 5000),
  'asset-stats.first': budget(800, 1200, 2000),
  'asset-stats.period-6': budget(400, 600, 1200),
  'asset-stats.period-12': budget(400, 600, 1200),
  'asset-stats.period-all': budget(400, 600, 1200),
  'asset-stats.period-3': budget(400, 600, 1200),
  'asset-stats.revisit': budget(400, 600, 1200),
  'ledger.add': budget(200, 350, 1000),
  'ledger.add.server-confirmed': budget(500, 1000, 5000),
  'ledger.delete': budget(200, 350, 1000),
  'ledger.delete.server-confirmed': budget(500, 1000, 5000),
  'android.home.activity-reopen-complete': budget(2000, 3000, 5000, androidProjects),
  'android.home.isolated-activity-complete': budget(2000, 3000, 5000, androidProjects, true),
  'android.quick-edit.notification-to-shown': budget(500, 800, 2000, androidProjects),
  'android.quick-edit.notification-to-ready': budget(700, 1000, 2000, androidProjects),
  'android.quick-edit.save-to-closed': budget(300, 500, 1000, androidProjects),
  'android.quick-edit.save-to-server-observed': budget(500, 1000, 5000, androidProjects),
});
const findBudget = metric => Object.hasOwn(PERFORMANCE_BUDGETS, metric) ? PERFORMANCE_BUDGETS[metric] : undefined;

// Runner-specific allowances are reviewed fixed values, never computed from the
// current run or a global multiplier. Unlisted paths retain the original UX limit.
export const PERFORMANCE_PROFILES = Object.freeze({
  'ux-v2': Object.freeze({ overrides: Object.freeze({}) }),
  'github-hosted-v2': Object.freeze({ overrides: Object.freeze({
    'webkit-mobile': Object.freeze({
      'home.fresh-context': budget(1500, 2000, 5000, ['webkit-mobile']),
      'home.relaunch': budget(1500, 2000, 5000, ['webkit-mobile']),
      'ledger.open-detail': budget(600, 800, 1000, ['webkit-mobile']),
      'assets.account-detail': budget(600, 800, 1000, ['webkit-mobile']),
      'ledger.save-memo': budget(400, 700, 1000, ['webkit-mobile']),
      'ledger.save-category': budget(400, 700, 1000, ['webkit-mobile']),
      'ledger.add': budget(650, 800, 1000, ['webkit-mobile']),
      'ledger.delete': budget(500, 700, 1000, ['webkit-mobile']),
      'assets.first': budget(900, 1200, 5000, ['webkit-mobile']),
      'search.next-page': budget(400, 650, 1000, ['webkit-mobile']),
      'search.change-keyword': budget(400, 650, 1000, ['webkit-mobile']),
    }),
    'android-emulator': Object.freeze({
      'android.home.activity-reopen-complete': budget(4000, 4500, 5000, androidProjects),
      'android.quick-edit.notification-to-shown': budget(1250, 1500, 2500, androidProjects),
      'android.quick-edit.notification-to-ready': budget(1500, 1800, 2500, androidProjects),
      'android.quick-edit.save-to-closed': budget(1200, 1500, 2000, androidProjects),
      'android.quick-edit.save-to-server-observed': budget(1000, 1500, 5000, androidProjects),
    }),
  }) }),
});

function assessTiming(row, limit, { errors, diagnostic }) {
  const requiredWithinBudget = Math.ceil(row.n * 6 / 7);
  const withinBudget = limit ? row.samplesMs.filter(value => value <= limit.sixOfSevenMs).length : 0;
  const reasons = [];
  if (!limit || !limit.projects.includes(row.project)) reasons.push('missing-budget');
  if (limit && row.medianMs > limit.medianMs) reasons.push('median-exceeded');
  if (limit && withinBudget < requiredWithinBudget) reasons.push('six-of-seven-exceeded');
  if (limit && row.maxMs > limit.maxMs) reasons.push('single-sample-maximum-exceeded');
  return { budget: limit ?? null,
    observed: { medianMs: row.medianMs, maxMs: row.maxMs, withinBudget, requiredWithinBudget },
    withinTimeBudget: reasons.length === 0,
    status: reasons.length > 0 ? 'fail' : errors.length > 0 ? 'invalid' : diagnostic ? 'diagnostic' : 'pass', reasons };
}

/** A complete diagnostic run can finish successfully, but can never claim PASS. */
export function evaluatePerformanceBudgets(samples, specification) {
  const { projects, metrics, samplesPerMetric, warmupMetrics = metrics, diagnostic = false, ci = false, profile = 'ux-v2' } = specification;
  const coverageErrors = validateSampleCoverage(samples, { projects, metrics, samplesPerMetric, warmupMetrics });
  const errors = [...coverageErrors];
  const selectedProfile = typeof profile === 'string' && Object.hasOwn(PERFORMANCE_PROFILES, profile) ? PERFORMANCE_PROFILES[profile] : undefined;
  if (!selectedProfile) errors.push(`Unknown performance profile: ${String(profile)}`);
  if (typeof diagnostic !== 'boolean' || typeof ci !== 'boolean') errors.push('Invalid performance gate mode');
  if (diagnostic && ci) errors.push('Diagnostic performance mode is not allowed in CI');
  if (!diagnostic && samplesPerMetric < MINIMUM_GATE_SAMPLES) {
    errors.push(`Performance PASS requires at least ${MINIMUM_GATE_SAMPLES} measured samples per metric; use explicit diagnostic mode for a shorter local run`);
  }
  for (const metric of Array.isArray(metrics) ? metrics : []) {
    const limit = findBudget(metric);
    if (!limit) { errors.push(`Missing performance budget: ${metric}`); continue; }
    if (limit.diagnosticOnly && !diagnostic) errors.push(`Diagnostic-only metric cannot receive PASS: ${metric}`);
    for (const project of Array.isArray(projects) ? projects : []) {
      if (!limit.projects.includes(project)) errors.push(`No performance budget for path: ${project}/${metric}`);
    }
  }
  // Even undeclared/warmup-only metrics must not bypass the reviewed budget map.
  for (const sample of Array.isArray(samples) ? samples : []) {
    if (!Object.hasOwn(PERFORMANCE_BUDGETS, sample?.metric)) errors.push(`Missing performance budget for sample: ${sample?.metric}`);
  }
  let statistics = [];
  try { statistics = summarizeSamples(samples); }
  catch (error) { errors.push(`Statistics: ${String(error)}`); }
  const results = statistics.map(row => {
    const uxLimit = findBudget(row.metric);
    const overrides = selectedProfile?.overrides;
    const projectOverrides = overrides && Object.hasOwn(overrides, row.project) ? overrides[row.project] : undefined;
    const override = projectOverrides && Object.hasOwn(projectOverrides, row.metric) ? projectOverrides[row.metric] : undefined;
    const limit = selectedProfile ? override ?? uxLimit : undefined;
    return { project: row.project, metric: row.metric, label: row.label, cacheState: row.cacheState, n: row.n,
      ...assessTiming(row, limit, { errors, diagnostic }), budgetSource: override ? profile : 'ux-v2',
      ux: assessTiming(row, uxLimit, { errors, diagnostic }) };
  });
  const exceeded = results.filter(row => !row.withinTimeBudget);
  const uxExceeded = results.filter(row => !row.ux.withinTimeBudget);
  const status = errors.length > 0 ? 'fail' : diagnostic ? 'diagnostic' : exceeded.length > 0 ? 'fail' : 'pass';
  const uxStatus = errors.length > 0 ? 'fail' : diagnostic ? 'diagnostic' : uxExceeded.length > 0 ? 'fail' : 'pass';
  return { policyVersion: PERFORMANCE_POLICY_VERSION, profile, status, uxStatus, mode: diagnostic ? 'diagnostic' : 'gate',
    minimumGateSamples: MINIMUM_GATE_SAMPLES, samplesRequested: samplesPerMetric,
    requiredWithinBudgetRule: 'ceil(measuredSampleCount * 6 / 7)',
    coverage: { complete: coverageErrors.length === 0, errors: coverageErrors }, errors, results,
    statistics, exceededMetrics: exceeded.map(row => `${row.project}/${row.metric}`),
    uxExceededMetrics: uxExceeded.map(row => `${row.project}/${row.metric}`),
    warmupSamples: Array.isArray(samples) ? samples.filter(sample => sample?.warmup === true) : [],
    firstExecutionPerformanceValidated: false };
}

export function budgetMarkdown(evaluation) {
  const lines = [
    `성능 판정: **${evaluation.status.toUpperCase()}** (적용 프로필: ${evaluation.profile}, ${evaluation.policyVersion}). UX 기준 비교: **${evaluation.uxStatus.toUpperCase()}**.`,
    '',
    '각 지표는 중앙값, 7회 중 6회(횟수가 다르면 ceil(n × 6 / 7)), 모든 개별 표본의 최대 허용 시간을 함께 검사합니다. 기준 이내의 상대적 속도 변화는 실패시키지 않습니다.',
  ];
  if (evaluation.profile !== 'ux-v2') lines.push('', 'CI 환경의 명시적 고정 허용값을 적용했습니다. 기존 UX 기준과 비교 결과도 함께 보존하며, CI 통과를 실기기 UX 통과로 해석하지 않습니다.');
  if (evaluation.mode === 'diagnostic') lines.push('', '진단 실행입니다. 시간 초과도 원본에 남기지만 성능 PASS를 부여하지 않습니다.');
  if (evaluation.errors.length) lines.push('', ...evaluation.errors.map(error => `- 검증 실패: ${error}`));
  lines.push('', '| 환경 | 동작 | 적용 판정 | UX 판정 | 중앙값 / 적용·UX 기준 ms | 6/7 기준 이내 (적용·UX) | 개별 최대 / 적용·UX 기준 ms |', '|---|---|---|---|---:|---:|---:|');
  for (const row of evaluation.results) lines.push(`| ${row.project} | ${row.label} | ${row.status.toUpperCase()}${row.reasons.length ? ` (${row.reasons.join(', ')})` : ''} | ${row.ux.status.toUpperCase()}${row.ux.reasons.length ? ` (${row.ux.reasons.join(', ')})` : ''} | ${row.observed.medianMs.toFixed(1)} / ${row.budget?.medianMs ?? '없음'}·${row.ux.budget?.medianMs ?? '없음'} | ${row.observed.withinBudget}·${row.ux.observed.withinBudget}/${row.n} (필요 ${row.observed.requiredWithinBudget}, ${row.budget?.sixOfSevenMs ?? '없음'}·${row.ux.budget?.sixOfSevenMs ?? '없음'}ms) | ${row.observed.maxMs.toFixed(1)} / ${row.budget?.maxMs ?? '없음'}·${row.ux.budget?.maxMs ?? '없음'} |`);
  lines.push('', '준비 실행은 위 반복 실행 판정에서 제외하여 별도로 보존합니다. 이 판정은 최초 실행이나 실제 휴대폰·운영 인터넷 성능의 합격을 의미하지 않습니다.');
  if (evaluation.warmupSamples.length) {
    lines.push('', '| 준비 실행 환경 | 동작 | 시간 ms |', '|---|---|---:|');
    for (const sample of evaluation.warmupSamples) lines.push(`| ${sample.project} | ${sample.label ?? sample.metric} | ${Number.isFinite(sample.durationMs) ? sample.durationMs.toFixed(1) : '잘못된 시간'} |`);
  }
  return lines.join('\n');
}

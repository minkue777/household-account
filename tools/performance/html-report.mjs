import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const number = value => Number.isFinite(value) ? value.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) : '—';
const attributeNumber = value => Number.isFinite(value) ? String(value) : '';
const projectName = project => ({ 'chromium-mobile': 'Chromium', 'webkit-mobile': 'WebKit',
  'android-emulator': 'Android 에뮬레이터' })[project] ?? project;
const statusName = status => ({ pass: '통과', passed: '통과', fail: '실패', failed: '실패',
  reported: '측정 완료', diagnostic: '진단', invalid: '검증 불가', missing: '미측정' })[status] ?? '미완료';
const statusClass = status => ['pass', 'passed'].includes(status) ? 'pass' : ['fail', 'failed'].includes(status) ? 'fail' : status === 'reported' ? 'comparison' : 'neutral';
const badge = status => `<span class="badge ${statusClass(status)}">${statusName(status)}</span>`;
const reasonName = reason => ({ 'median-exceeded': '중앙값 초과', 'six-of-seven-exceeded': '반복 허용 시간 초과',
  'single-sample-maximum-exceeded': '개별 최대 시간 초과', 'missing-budget': '기준 없음' })[reason] ?? reason;
const key = row => JSON.stringify([row.project, row.metric, row.cacheState]);
const groupNames = { home: '첫 화면', search: '검색', 'expense-stats': '지출 통계', 'asset-stats': '자산 통계',
  assets: '자산', ledger: '가계부', 'android.home': '앱 재실행', 'android.quick-edit': '퀵에딧' };
const groupFor = metric => metric.startsWith('android.') ? metric.split('.').slice(0, 2).join('.') : metric.split('.')[0];
const shortLabel = row => `${(row.label ?? row.metric).split(' → ')[0]}${row.metric.endsWith('.server-confirmed') ? ' · 서버 확정' : ''}`;

function comparisonName(withinBudget) {
  return withinBudget === true ? '기준 이내' : withinBudget === false ? '기준 초과' : '비교 불가';
}

const comparisonBadge = result => result?.status === 'reported'
  ? `<span class="badge comparison">${comparisonName(result.withinTimeBudget)}</span>` : badge(result?.status);

// These pure scale functions are also used by the offline controls below.
function ratio(value, limit) {
  return Number.isFinite(value) && value >= 0 && Number.isFinite(limit) && limit > 0 ? value / limit : NaN;
}
function axisFor(ratios) {
  return Math.ceil(Math.max(1.25, ...ratios.filter(Number.isFinite)) * 4) / 4;
}

function measuredValues(row, statistics) {
  const values = statistics?.samplesMs ?? [];
  const required = row.observed?.requiredWithinBudget;
  const repeat = Number.isInteger(required) && required > 0 && required <= values.length
    && values.length === row.n && values.every(value => Number.isFinite(value) && value >= 0)
    ? [...values].sort((a, b) => a - b)[required - 1] : undefined;
  return { median: row.observed?.medianMs, repeat, max: row.observed?.maxMs };
}

function preciseNumber(value, ...limits) {
  return Number.isFinite(value) && limits.some(limit => value > limit && Number(value.toFixed(1)) <= limit) ? String(value) : number(value);
}

function renderRow(row, statistics, axis, project, reportOnly) {
  const values = measuredValues(row, statistics);
  const limits = { ci: row.budget ?? {}, ux: row.ux?.budget ?? {} };
  const proportion = ratio(values.median, limits.ci.medianMs);
  const verified = ['pass', 'fail', 'reported'].includes(row.status);
  const tone = !verified || !Number.isFinite(proportion) ? 'unverified' : proportion > 1 ? 'exceeded' : 'within';
  const width = Number.isFinite(proportion) ? proportion / axis * 100 : 0;
  const label = row.label ?? row.metric;
  const reasons = (row.reasons ?? []).map(reasonName);
  const uxReasons = (row.ux?.reasons ?? []).map(reasonName);
  const aria = `${label}: 중앙값 ${attributeNumber(values.median) || '미측정'} ms, ${reportOnly ? '참고선' : '허용'} ${attributeNumber(limits.ci.medianMs) || '미기록'} ms${Number.isFinite(proportion) ? `, 기준 대비 ${number(proportion * 100)}%` : ''}`;
  const detailRows = [['중앙값', values.median, 'medianMs'], [reportOnly ? '반복 참고 시간' : '반복 허용 시간', values.repeat, 'sixOfSevenMs'], ['개별 최대', values.max, 'maxMs']];
  const rowLabel = row.status === 'reported' ? comparisonName(row.withinTimeBudget) : statusName(row.status);
  return `<details class="metric-row" data-project="${escape(row.project)}" data-status="${escape(row.status)}" data-ux="${escape(row.ux?.status)}"
    data-ci-within="${escape(row.withinTimeBudget)}" data-ux-within="${escape(row.ux?.withinTimeBudget)}"
    data-label="${escape(label)}" data-search="${escape(`${label} ${row.metric} ${row.project}`.toLowerCase())}"
    data-median="${attributeNumber(values.median)}" data-repeat="${attributeNumber(values.repeat)}" data-max="${attributeNumber(values.max)}"
    ${Object.entries(limits).map(([profile, limit]) => `data-${profile}-median="${attributeNumber(limit.medianMs)}" data-${profile}-repeat="${attributeNumber(limit.sixOfSevenMs)}" data-${profile}-max="${attributeNumber(limit.maxMs)}"`).join(' ')}
    ${row.project === project ? '' : 'hidden'}>
    <summary title="${escape(label)}">
      <span class="metric-name">${escape(shortLabel(row))}<small>${escape(projectName(row.project))}</small></span>
      <span class="plot" role="img" aria-label="${escape(aria)}" title="${escape(aria)}">
        <span class="track"></span><span class="bar ${tone}" style="width:${width}%"></span><span class="threshold"></span>
        ${Number.isFinite(proportion) ? '' : '<span class="unmeasured">미측정</span>'}</span>
      <span class="row-status ${row.status === 'reported' ? 'comparison' : statusClass(row.status)}" title="전체 조건: ${escape(rowLabel)}" aria-label="전체 조건: ${escape(rowLabel)}">${row.status === 'reported' ? row.withinTimeBudget === false ? '↑' : '·' : row.status === 'pass' ? '✓' : row.status === 'fail' ? '!' : '—'}</span>
    </summary>
    <div class="metric-detail">
      <p>${escape(label)} <code>${escape(row.metric)}</code></p>
      <div class="detail-verdicts"><span>${reportOnly ? `환경 참고선 ${comparisonBadge(row)}` : `CI ${badge(row.status)}`}</span><span>${reportOnly ? `UX 참고선 ${comparisonBadge(row.ux)}` : `UX ${badge(row.ux?.status)}`}</span></div>
      <table><thead><tr><th>조건</th><th>측정 ms</th><th>${reportOnly ? '환경 참고선' : 'CI 기준'} ms</th><th>${reportOnly ? 'UX 참고선' : 'UX 기준'} ms</th></tr></thead><tbody>
        ${detailRows.map(([name, value, property]) => `<tr><th>${name}</th><td>${preciseNumber(value, limits.ci[property], limits.ux[property])}</td><td>≤ ${number(limits.ci[property])}</td><td>≤ ${number(limits.ux[property])}</td></tr>`).join('')}
      </tbody></table>
      <p>반복 기준 이내 ${number(row.observed?.withinBudget)} / ${number(row.n)}회 · ${reportOnly ? '참고 횟수' : '최소'} ${number(row.observed?.requiredWithinBudget)}회${reportOnly ? '' : ' 필요'}</p>
      ${reasons.length ? `<p class="reason">${reportOnly ? '환경' : 'CI'}: ${reasons.map(escape).join(' · ')}</p>` : ''}
      ${uxReasons.length ? `<p class="reason">UX: ${uxReasons.map(escape).join(' · ')}</p>` : ''}
      <p class="sample-values">${(statistics?.samplesMs ?? []).map(value => `<span>${number(value)}</span>`).join(' ')}<small>ms · 본 측정 순서</small></p>
      <p class="cache">${escape(row.cacheState ?? '측정 조건 없음')}</p>
    </div>
  </details>`;
}

// Use the saved verdict and budgets, not today's configuration for a historic run.
export function renderPerformanceReport(report, { title } = {}) {
  const performance = report?.performance;
  if (!performance || !Array.isArray(performance.results)) throw new Error('판정 결과가 포함된 성능 JSON이 필요합니다.');
  const reportOnly = performance.mode === 'report-only';
  const rows = [...performance.results];
  for (const project of report.coverage?.projects ?? []) for (const metric of report.coverage?.metrics ?? []) {
    if (!rows.some(row => row.project === project && row.metric === metric)) rows.push({ project, metric, n: 0, status: 'missing' });
  }
  const projects = [...new Set(rows.map(row => row.project))];
  const defaultProject = projects.includes('webkit-mobile') ? 'webkit-mobile' : projects[0];
  const android = projects.includes('android-emulator') || report.suite === 'native-firebase-performance';
  title ??= android ? 'Android 성능' : '성능';
  const statistics = new Map((performance.statistics ?? report.statistics ?? []).map(row => [key(row), row]));
  const groups = [...new Set(rows.map(row => groupFor(row.metric)))].sort((a, b) => {
    const order = Object.keys(groupNames);
    return (order.includes(a) ? order.indexOf(a) : order.length) - (order.includes(b) ? order.indexOf(b) : order.length);
  });
  const axis = axisFor(rows.filter(row => row.project === defaultProject).map(row => ratio(row.observed?.medianMs, row.budget?.medianMs)));
  const complete = performance.coverage?.complete === true && report.coverage?.complete !== false;
  const errors = [...new Set([...(report.failures ?? []), ...(report.validationErrors ?? []), ...(report.coverage?.errors ?? []), ...(performance.errors ?? [])])];
  const executionStatus = errors.length || !complete ? 'failed' : report.status;
  const host = report.host ?? report.environment ?? {};
  const environment = report.environment ?? {};
  const metadata = [
    ['측정 시각', report.timestamp ?? report.recordedAt], ['커밋', report.commit], ['프로필', performance.profile], ['기준 버전', performance.policyVersion],
    ['표본', `${complete ? '완전' : '불완전'} · 경로별 ${number(performance.samplesRequested)}회`],
    ['CPU', host.cpu], ['실행 환경', host.os ?? host.platform],
    ['브라우저 / WebView', environment.playwright ?? environment.webView], ['기기', environment.device],
  ].filter(([, value]) => value !== undefined);
  const warmup = performance.warmupSamples ?? [];
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escape(title)}</title><style>${styles}</style></head>
<body><main data-mode="${escape(performance.mode)}" style="--threshold:${100 / axis}%">
  <header data-execution-status="${escape(executionStatus)}"><h1>${escape(title)}</h1><span class="run-status">${reportOnly ? '측정' : '실행'} ${badge(reportOnly && executionStatus === 'passed' ? 'reported' : executionStatus)}</span></header>
  <div class="toolbar">
    <select id="project-filter" aria-label="환경">${projects.map(project => `<option value="${escape(project)}" ${project === defaultProject ? 'selected' : ''}>${escape(projectName(project))}</option>`).join('')}<option value="">모든 환경</option></select>
    <fieldset class="segments"><legend class="sr-only">측정 항목</legend>${[['median', '중앙값'], ['repeat', '반복 6/7'], ['max', '최대']].map(([value, label]) => `<label><input type="radio" name="measure" value="${value}" ${value === 'median' ? 'checked' : ''}><span>${label}</span></label>`).join('')}</fieldset>
    <select id="basis-filter" aria-label="비교 기준"><option value="ci">${reportOnly ? '환경 참고선' : 'CI 기준'}</option><option value="ux">${reportOnly ? 'UX 참고선' : 'UX 목표'}</option></select>
    <input id="metric-filter" type="search" aria-label="기능 검색" placeholder="기능 찾기" autocomplete="off">
    <label class="failed-only"><input id="failure-filter" type="checkbox">${reportOnly ? '기준 초과만' : '실패만'}</label>
  </div>
  <div class="legend"><span><i class="swatch within"></i>기준 이내</span><span><i class="swatch exceeded"></i>초과</span><span><i class="line-key"></i>${reportOnly ? '참고선' : '허용 기준'}</span><small>기준 대비 시간 · 짧을수록 빠름</small></div>
  ${errors.length || !complete ? `<details class="errors"><summary>측정·검증 오류 ${errors.length}건${complete ? '' : ' · 표본 불완전'}</summary><ul>${errors.map(error => `<li>${escape(error)}</li>`).join('')}</ul></details>` : ''}
  ${performance.mode === 'diagnostic' ? '<p class="diagnostic">진단 실행 · 정식 PASS 없음</p>' : ''}
  <div class="charts">${groups.map(group => `<section class="chart-group" data-group="${escape(group)}" ${rows.some(row => row.project === defaultProject && groupFor(row.metric) === group) ? '' : 'hidden'}>
    <h2>${escape(groupNames[group] ?? group)}</h2>
    <div class="axis" aria-hidden="true"><span>0</span><b class="axis-threshold">100%</b><span class="axis-max">${number(axis * 100)}%</span></div>
    ${rows.filter(row => groupFor(row.metric) === group).map(row => renderRow(row, statistics.get(key(row)), axis, defaultProject, reportOnly)).join('\n')}
  </section>`).join('')}</div>
  <p id="empty" ${rows.length ? 'hidden' : ''}>해당하는 측정 결과가 없습니다.</p><span id="visible-count" class="sr-only" aria-live="polite"></span>
  <details class="appendix"><summary>실행 정보 · ${reportOnly ? '측정' : '판정'} 상세</summary>
    ${reportOnly ? `<p>측정 ${badge(performance.status)}</p>
    <p>막대는 선택한 조건의 참고 시간 대비 비율입니다. 시간 초과는 참고용으로 표시하며 CI 성공 여부에 영향을 주지 않습니다.</p>
    <p>반복은 기록된 참고 횟수번째 본표본(7회 중 6회)을 사용하며 준비 실행은 제외합니다.</p>` : `<p>CI ${badge(performance.status)} · 공통 UX ${badge(performance.uxStatus)}</p>
    <p>막대는 선택한 조건의 허용 시간 대비 비율입니다. 행의 상태 아이콘은 세 조건을 합친 원본 판정을 유지합니다. 모든 조건을 만족해야 통과합니다.</p>
    <p>반복은 기록된 최소 허용 횟수번째 본표본(7회 중 6회)을 사용합니다. 정식 판정은 최소 ${number(performance.minimumGateSamples)}회이며 준비 실행은 제외합니다.</p>`}
    <p>기준은 이 실행의 JSON에 기록된 값입니다. 에뮬레이터 측정이며 실제 휴대폰·운영 네트워크 시간과 다릅니다.</p>
    <dl>${metadata.map(([name, value]) => `<dt>${escape(name)}</dt><dd>${escape(value)}</dd>`).join('')}</dl>
    <details class="warmup"><summary>준비 실행 ${warmup.length}개</summary><ul>${warmup.map(sample => `<li>${escape(projectName(sample.project))} · ${escape(sample.label ?? sample.metric)} · ${number(sample.durationMs)} ms</li>`).join('')}</ul></details>
  </details>
</main><script>${ratio.toString()}\n${axisFor.toString()}\n${comparisonName.toString()}\n${controls}</script></body></html>`;
}

const styles = `
.comparison{color:#607089;background:#edf2fa}
:root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#182539;background:#f5f7fb;color-scheme:light;font-size:14px}*{box-sizing:border-box}body{margin:0}main{max-width:1320px;margin:auto;padding:28px 30px 40px}h1,h2,p{margin:0}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}h1{font-size:27px;letter-spacing:-1px}.run-status{font-size:12px;color:#748196}.badge{display:inline-block;padding:3px 7px;border-radius:5px;font-size:11px;font-weight:700}.pass{color:#267459;background:#e7f5ef}.fail{color:#bd3949;background:#ffebee}.neutral{color:#976312;background:#fff2da}
.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:18px}select,input,button{font:inherit}select,input[type=search]{padding:9px 12px;border:1px solid #dce3ee;background:white;color:#30435e;border-radius:8px;height:40px}#project-filter{min-width:145px}#metric-filter{width:160px;margin-left:auto}.segments{display:flex;padding:3px;margin:0;border:1px solid #dfe5ef;border-radius:9px;background:#eaf0f8;gap:3px}.segments label{cursor:pointer}.segments input{position:absolute;opacity:0;pointer-events:none}.segments span{display:block;padding:6px 13px;border-radius:6px;font-size:13px;color:#607089}.segments input:checked+span{background:white;color:#235ed0;box-shadow:0 1px 4px #253c651a;font-weight:700}.segments input:focus-visible+span{outline:2px solid #346fe1}.failed-only{font-size:12px;color:#607089;white-space:nowrap;display:flex;gap:4px;align-items:center}.failed-only input{accent-color:#386fd7}:focus-visible{outline:2px solid #4c87f3;outline-offset:3px}
.legend{display:flex;align-items:center;gap:18px;color:#667791;font-size:11px;margin:0 2px 16px}.legend span{display:flex;align-items:center;gap:6px}.legend small{margin-left:auto;font-size:11px}.swatch{height:8px;width:18px;border-radius:3px}.within{background:#5a83ed}.exceeded{background:#f16476}.unverified{background:repeating-linear-gradient(120deg,#edc57d,#edc57d 4px,#f9e8c9 4px,#f9e8c9 8px)}.line-key{height:13px;border-left:2px dashed #718097}
.charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;align-items:start}.chart-group{--label:182px;--status:22px;background:white;border:1px solid #e2e7f0;border-radius:14px;padding:20px 18px 15px;min-width:0}.chart-group h2{font-size:16px;font-weight:750;margin:0 0 12px;letter-spacing:-.3px}.axis{position:relative;height:24px;margin-left:calc(var(--label) + 10px);margin-right:calc(var(--status) + 10px);display:flex;justify-content:space-between;font-size:10px;color:#9ba7b8}.axis-threshold{position:absolute;left:var(--threshold);transform:translateX(-50%);font-weight:700;color:#74869f}
.metric-row{border-top:1px solid #f0f3f8}.metric-row>summary{display:grid;grid-template-columns:var(--label) minmax(0,1fr) var(--status);align-items:center;gap:10px;min-height:44px;cursor:pointer;list-style:none;padding:7px 0}.metric-row>summary::-webkit-details-marker{display:none}.metric-row>summary:hover .metric-name{color:#326ae0}.metric-name{font-size:12px;line-height:1.4;min-width:0;overflow-wrap:anywhere}.metric-name small{display:none;color:#95a1b1;font-size:10px;margin-top:2px}main.all-projects .metric-name small{display:block}.plot{position:relative;display:block;height:22px}.track{position:absolute;inset:4px 0;background:#f0f3f9;border-radius:4px}.bar{position:absolute;left:0;top:4px;height:14px;min-width:0;border-radius:4px;transition:width .16s ease}.threshold{position:absolute;left:var(--threshold);top:0;height:22px;border-left:2px dashed #8694aa;z-index:1}.row-status{justify-self:end;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;font-size:10px;border-radius:50%;font-weight:800}.row-status.pass{background:transparent;color:#a1b7b1}.unmeasured{position:absolute;left:6px;top:4px;font-size:10px;color:#a77b31}
.metric-detail{font-size:12px;color:#576981;padding:12px 2px 15px;line-height:1.7}.metric-detail>p{margin:8px 0;overflow-wrap:anywhere}code{font-size:10px;color:#8b98aa;display:block}.detail-verdicts{display:flex;gap:16px;margin-top:8px}.metric-detail table{width:100%;border-collapse:collapse;font-size:11px;font-variant-numeric:tabular-nums;margin:12px 0}.metric-detail th,.metric-detail td{text-align:left;padding:6px 4px;border-bottom:1px solid #edf1f7}.metric-detail th{font-weight:500;color:#7c8ca2}.reason{color:#bd4656}.sample-values{display:flex;flex-wrap:wrap;gap:4px}.sample-values span{padding:2px 6px;border-radius:5px;background:#edf2fa}.sample-values small{color:#8393a9}.cache{color:#8997a9;font-size:10px}
.appendix{margin-top:22px;font-size:12px;color:#7b8aa0;line-height:1.8}.appendix summary{cursor:pointer}.appendix>p{margin:10px 0}.appendix dl{display:grid;grid-template-columns:110px 1fr;gap:6px}.appendix dd{margin:0;overflow-wrap:anywhere}.warmup{margin-top:15px}.errors{background:#fff0f2;color:#a73342;border-radius:9px;padding:10px 14px;margin-bottom:14px;font-size:12px}.errors summary{cursor:pointer}.errors li{overflow-wrap:anywhere}.diagnostic{font-size:12px;color:#9a6b23;margin:0 0 14px}#empty{text-align:center;padding:40px;color:#8b99ab}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}[hidden]{display:none!important}
@media(max-width:1000px){.charts{grid-template-columns:1fr}.chart-group{--label:230px}.legend{flex-wrap:wrap}.legend small{margin-left:0}}@media(max-width:560px){main{padding:20px 14px}.toolbar{gap:8px}h1{font-size:24px}#project-filter{min-width:130px}.segments span{padding:6px 9px;font-size:12px}#metric-filter{width:130px;margin-left:0;flex:1}#basis-filter{width:115px}.legend{gap:12px}.legend small{flex-basis:100%}.chart-group{--label:130px;--status:16px;padding:16px 12px}.chart-group h2{font-size:15px}.metric-row>summary{gap:8px;min-height:46px}.metric-name{font-size:11px}.axis{margin-left:calc(var(--label) + 8px);margin-right:calc(var(--status) + 8px)}.axis-threshold{font-size:9px}.metric-detail table{font-size:10px}}
@media(max-width:560px){.axis-max{visibility:hidden}}
@media(prefers-reduced-motion:reduce){.bar{transition:none}}@media print{body{background:white}main{padding:0;max-width:none}.toolbar{display:none}.charts{display:block}.chart-group{break-inside:avoid;margin-bottom:14px}.bar{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

const controls = `
(() => {
  const main = document.querySelector('main');
  const reportOnly = main.dataset.mode === 'report-only';
  const rows = [...document.querySelectorAll('.metric-row')];
  const project = document.getElementById('project-filter');
  const basis = document.getElementById('basis-filter');
  const query = document.getElementById('metric-filter');
  const failed = document.getElementById('failure-filter');
  const read = (row, name) => row.getAttribute('data-' + name) === '' ? NaN : Number(row.getAttribute('data-' + name));
  const labels = { median: '중앙값', repeat: reportOnly ? '반복 참고 시간' : '반복 허용 시간', max: '개별 최대' };
  function update() {
    const measure = document.querySelector('input[name=measure]:checked').value;
    const keyword = query.value.trim().toLowerCase();
    const visible = [];
    for (const row of rows) {
      const status = basis.value === 'ci' ? row.dataset.status : row.dataset.ux;
      const withinBudget = row.getAttribute('data-' + basis.value + '-within');
      row.hidden = !!((project.value && row.dataset.project !== project.value) || !row.dataset.search.includes(keyword)
        || (failed.checked && (reportOnly ? status !== 'reported' || withinBudget !== 'false' : status === 'pass')));
      if (!row.hidden) visible.push(row);
    }
    const axis = axisFor(visible.map(row => ratio(read(row, measure), read(row, basis.value + '-' + measure))));
    main.style.setProperty('--threshold', 100 / axis + '%');
    main.classList.toggle('all-projects', !project.value);
    for (const row of visible) {
      const value = read(row, measure), limit = read(row, basis.value + '-' + measure);
      const proportion = ratio(value, limit);
      const status = basis.value === 'ci' ? row.dataset.status : row.dataset.ux;
      const verified = status === 'pass' || status === 'fail' || status === 'reported';
      const bar = row.querySelector('.bar');
      bar.className = 'bar ' + (!verified || !Number.isFinite(proportion) ? 'unverified' : proportion > 1 ? 'exceeded' : 'within');
      bar.style.width = Number.isFinite(proportion) ? proportion / axis * 100 + '%' : '0%';
      const plot = row.querySelector('.plot');
      const description = row.dataset.label + ': ' + labels[measure] + ' ' + (Number.isFinite(value) ? value : '미측정')
        + ' ms, ' + (reportOnly ? '참고선 ' : '허용 ') + (Number.isFinite(limit) ? limit : '미기록') + ' ms'
        + (Number.isFinite(proportion) ? ', 기준 대비 ' + (proportion * 100).toFixed(1) + '%' : '');
      plot.setAttribute('aria-label', description); plot.title = description;
      let missing = plot.querySelector('.unmeasured');
      if (!Number.isFinite(proportion) && !missing) { missing = document.createElement('span'); missing.className = 'unmeasured'; missing.textContent = '미측정'; plot.append(missing); }
      if (missing) missing.hidden = Number.isFinite(proportion);
      const icon = row.querySelector('.row-status');
      const withinBudget = row.getAttribute('data-' + basis.value + '-within');
      const label = status === 'reported' ? comparisonName(withinBudget === 'true' ? true : withinBudget === 'false' ? false : undefined)
        : status === 'pass' ? '통과' : status === 'fail' ? '실패' : status === 'invalid' ? '검증 불가' : status === 'missing' ? '미측정' : '미확인';
      icon.className = 'row-status ' + (status === 'reported' ? 'comparison' : status === 'pass' ? 'pass' : status === 'fail' ? 'fail' : 'neutral');
      icon.textContent = status === 'reported' ? withinBudget === 'false' ? '↑' : '·' : status === 'pass' ? '✓' : status === 'fail' ? '!' : '—';
      icon.title = '전체 조건: ' + label; icon.setAttribute('aria-label', icon.title);
    }
    for (const group of document.querySelectorAll('.chart-group')) {
      group.hidden = ![...group.querySelectorAll('.metric-row')].some(row => !row.hidden);
      group.querySelector('.axis-max').textContent = (axis * 100).toLocaleString('ko-KR') + '%';
    }
    document.getElementById('visible-count').textContent = visible.length + '개 측정 경로';
    document.getElementById('empty').hidden = visible.length !== 0;
  }
  document.querySelectorAll('.toolbar input, .toolbar select').forEach(control => control.addEventListener('input', update));
  update();
})();
`;

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || resolve(input) === resolve(output)) {
    console.error('사용법: node tools/performance/html-report.mjs input.json output.html (서로 다른 파일)');
    process.exitCode = 1;
  } else {
    writeFileSync(output, renderPerformanceReport(JSON.parse(readFileSync(input, 'utf8'))), 'utf8');
    console.log(`성능 HTML 보고서: ${output}`);
  }
}

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const number = value => Number.isFinite(value) ? value.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) : '—';
const projectName = project => ({ 'chromium-mobile': 'Chromium · 모바일', 'webkit-mobile': 'WebKit · 모바일',
  'android-emulator': 'Android · 에뮬레이터' })[project] ?? project;
const statusName = status => ({ pass: '통과', passed: '통과', fail: '실패', failed: '실패',
  diagnostic: '진단', invalid: '검증 불가', missing: '미측정' })[status] ?? '미완료';
const statusClass = status => ['pass', 'passed'].includes(status) ? 'pass'
  : ['fail', 'failed'].includes(status) ? 'fail' : 'neutral';
const badge = status => `<span class="badge ${statusClass(status)}">${statusName(status)}</span>`;
const reasonName = reason => ({ 'median-exceeded': '중앙값 초과', 'six-of-seven-exceeded': '반복 허용 시간 초과',
  'single-sample-maximum-exceeded': '개별 최대 시간 초과', 'missing-budget': '기준 없음' })[reason] ?? reason;
const key = row => JSON.stringify([row.project, row.metric, row.cacheState]);

function timingCell(observed, limit, failed) {
  // Do not round a real boundary failure back onto the passing threshold.
  const value = Number.isFinite(observed) && observed > limit && Number(observed.toFixed(1)) <= limit
    ? String(observed) : number(observed);
  return `<td class="timing ${failed ? 'exceeded' : ''}"><strong>${value}</strong>
    <span class="limit">기준 ≤ ${number(limit)} ms</span></td>`;
}

function renderRow(row, statistics) {
  const observed = row.observed ?? {};
  const limit = row.budget;
  const ux = row.ux ?? {};
  const reasons = (row.reasons ?? []).map(reasonName);
  const uxReasons = (ux.reasons ?? []).map(reasonName);
  const missing = row.status === 'missing';
  const values = statistics?.samplesMs ?? [];
  const label = row.label ?? row.metric;
  return `<tr data-project="${escape(row.project)}" data-status="${escape(row.status)}" data-ux="${escape(ux.status)}"
    data-search="${escape(`${label} ${row.metric} ${row.project}`.toLowerCase())}">
    <td><span class="project">${escape(projectName(row.project))}</span><strong class="metric">${escape(label)}</strong>
      <code>${escape(row.metric)}</code>
      <details class="samples"><summary>표본 · 측정 조건</summary>
        <p>본 측정 ${number(row.n)}회 · 최소 ${number(statistics?.minMs)} / 평균 ${number(statistics?.meanMs)} ms</p>
        <p class="sample-values">${values.length ? values.map(value => `<span>${number(value)}</span>`).join(' ') : '측정 표본 없음'} <small>ms · 측정 순서</small></p>
        <p class="cache">${escape(row.cacheState ?? '측정 조건 없음')}</p>
      </details></td>
    <td>${badge(row.status)}${reasons.length ? `<p class="reason">${reasons.map(escape).join('<br>')}</p>` : ''}</td>
    ${timingCell(observed.medianMs, limit?.medianMs, reasons.includes('중앙값 초과'))}
    <td class="timing ${reasons.includes('반복 허용 시간 초과') ? 'exceeded' : ''}">
      <strong>${missing ? '—' : `${number(observed.withinBudget)} / ${number(row.n)}회`}</strong>
      <span class="limit">${missing ? '기준 기록 없음' : `최소 ${number(observed.requiredWithinBudget)}회 ≤ ${number(limit?.sixOfSevenMs)} ms`}</span>
    </td>
    ${timingCell(observed.maxMs, limit?.maxMs, reasons.includes('개별 최대 시간 초과'))}
    <td class="ux-cell">${badge(ux.status)}
      <details><summary>UX 기준 보기</summary>
        <dl><dt>중앙값</dt><dd>≤ ${number(ux.budget?.medianMs)} ms</dd>
          <dt>반복 허용 시간</dt><dd>≤ ${number(ux.budget?.sixOfSevenMs)} ms</dd>
          <dt>개별 최대</dt><dd>≤ ${number(ux.budget?.maxMs)} ms</dd></dl>
        <p>${number(ux.observed?.withinBudget)} / ${number(row.n)}회 기준 이내</p>
        ${uxReasons.length ? `<p class="reason">${uxReasons.map(escape).join('<br>')}</p>` : ''}
      </details><small>${escape(row.budgetSource ?? '기준 기록 없음')}</small></td>
  </tr>`;
}

// Render the evaluated snapshot, never re-evaluate an old run against today's budgets.
export function renderPerformanceReport(report, { title } = {}) {
  const performance = report?.performance;
  if (!performance || !Array.isArray(performance.results)) throw new Error('판정 결과가 포함된 성능 JSON이 필요합니다.');
  const rows = [...performance.results];
  for (const project of report.coverage?.projects ?? []) for (const metric of report.coverage?.metrics ?? []) {
    if (!rows.some(row => row.project === project && row.metric === metric)) rows.push({ project, metric, n: 0, status: 'missing' });
  }
  const projects = [...new Set(rows.map(row => row.project))];
  const android = projects.includes('android-emulator') || report.suite === 'native-firebase-performance';
  title ??= android ? 'Android 성능 보고서' : '핵심 기능 성능 보고서';
  const statistics = new Map((performance.statistics ?? report.statistics ?? []).map(row => [key(row), row]));
  const errors = [...new Set([...(report.failures ?? []), ...(report.validationErrors ?? []),
    ...(report.coverage?.errors ?? []), ...(performance.errors ?? [])])];
  const complete = performance.coverage?.complete === true && report.coverage?.complete !== false;
  const warmup = performance.warmupSamples ?? [];
  const host = report.host ?? report.environment ?? {};
  const environment = report.environment ?? {};
  const metadata = [
    ['측정 시각', report.timestamp ?? report.recordedAt], ['커밋', report.commit],
    ['실행 환경', host.os ?? [host.platform, host.osRelease].filter(Boolean).join(' ')], ['CPU', host.cpu],
    ['브라우저 / WebView', environment.playwright ? `Playwright ${environment.playwright}` : environment.webView],
    ['기기', environment.device], ['빌드', environment.build ?? environment.web],
    ['데이터 연결', environment.backend ?? environment.firebase],
  ].filter(([, value]) => value !== undefined && value !== '');
  const executionStatus = errors.length || !complete ? 'failed' : report.status;
  const resultLabel = performance.profile === 'ux-v2' ? '적용 기준 판정' : 'CI 기준 판정';
  return `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escape(title)}</title><style>${styles}</style></head>
<body><main>
  <header><p class="eyebrow">HOUSEHOLD ACCOUNT · PERFORMANCE</p><h1>${escape(title)}</h1>
    <p class="intro">얼마나 걸렸는지, 어떤 기준으로 통과했는지 한눈에 확인하세요.</p>
    <div class="metadata"><span>${escape(report.timestamp ?? report.recordedAt ?? '측정 시각 없음')}</span>
      ${report.commit ? `<code>${escape(report.commit.slice(0, 12))}${report.workingTreeDirty ? ' · 미커밋 변경 포함' : ''}</code>` : ''}
      <span>${escape(performance.profile)}</span></div></header>
  <section class="cards" aria-label="판정 요약">
    <article><h2>전체 실행</h2>${badge(executionStatus)}<p>기능 검증 · 보고서 오류 포함</p></article>
    <article><h2>${resultLabel}</h2>${badge(performance.status)}<p>통과 ${rows.filter(row => row.status === 'pass').length} / ${rows.length}개 측정 경로</p></article>
    <article><h2>공통 UX 목표 비교</h2>${badge(performance.uxStatus)}<p>별도 목표와 비교한 결과</p></article>
    <article><h2>표본 검증</h2><strong class="coverage ${complete ? 'good' : 'bad'}">${complete ? '완전' : '불완전'}</strong>
      <p>경로별 본 측정 ${number(performance.samplesRequested)}회</p></article>
  </section>
  <section class="policy" aria-label="성능 통과 기준 안내">
    <h2>세 조건을 모두 만족해야 통과합니다</h2>
    <ol><li><b>중앙값</b>이 기능별 허용 시간 이내</li><li><b>7회 중 6회 이상</b>이 반복 허용 시간 이내</li><li><b>모든 개별 측정</b>이 최대 허용 시간 이내</li></ol>
    <p>정식 판정은 최소 ${number(performance.minimumGateSamples)}회가 필요합니다. 횟수가 다르면 반복 조건은 ceil(n × 6 / 7)이며, 준비 실행은 별도로 보관합니다.</p>
    <p>표의 기준은 <b>이 실행의 JSON에 기록된 값</b>입니다. ${performance.profile === 'ux-v2' ? '공통 UX 목표를 적용했습니다.' : 'CI 환경의 허용값과 공통 UX 목표는 다를 수 있으며, UX 목표 초과가 곧 CI 실패를 뜻하지는 않습니다.'}</p>
    <p>에뮬레이터·합성 데이터 측정입니다. 실제 휴대폰의 최초 실행이나 운영 네트워크 성능을 보증하지 않습니다.</p>
  </section>
  ${performance.mode === 'diagnostic' ? '<aside class="notice">진단 실행입니다. 표본이 완전하거나 시간이 기준 이내여도 정식 PASS를 부여하지 않습니다.</aside>' : ''}
  ${errors.length || !complete ? `<aside class="notice error" role="alert"><h2>측정 또는 검증 오류</h2>
    <p>표시된 일부 측정값만으로 전체 통과를 판단할 수 없습니다.</p><ul>${errors.map(error => `<li>${escape(error)}</li>`).join('')}</ul></aside>` : ''}
  <section aria-labelledby="results-title"><div class="results-heading"><h2 id="results-title">기능별 측정 결과와 통과 기준</h2>
    <span id="visible-count" aria-live="polite">${rows.length}개 경로</span></div>
    <form class="filters" onsubmit="return false">
      <label><span id="project-label">환경</span><select id="project-filter" aria-labelledby="project-label"><option value="">모든 환경</option>${projects.map(project => `<option value="${escape(project)}">${escape(projectName(project))}</option>`).join('')}</select></label>
      <label><span id="status-label">판정</span><select id="status-filter" aria-labelledby="status-label"><option value="">전체 결과</option><option value="attention">실패 · 미완료만</option><option value="ux">UX 목표 초과만</option></select></label>
      <label class="search"><span id="metric-label">기능 검색</span><input id="metric-filter" aria-labelledby="metric-label" type="search" placeholder="예: 검색, 첫 홈, 퀵에딧" autocomplete="off"></label>
    </form>
    <div class="table-scroll" tabindex="0" role="region" aria-label="성능 결과 표, 좁은 화면에서는 좌우로 스크롤하세요">
      <table><caption>단위 ms · 실측값 아래에 적용 허용값을 표시합니다.</caption>
        <thead><tr><th scope="col">환경 · 기능</th><th scope="col">적용 판정</th><th scope="col">중앙값</th><th scope="col">반복 기준 이내</th><th scope="col">개별 최대</th><th scope="col">공통 UX 목표</th></tr></thead>
        <tbody>${rows.map(row => renderRow(row, statistics.get(key(row)))).join('\n')}</tbody></table>
    </div><p id="empty" class="empty" ${rows.length ? 'hidden' : ''}>표시할 측정 결과가 없습니다.</p>
  </section>
  <details class="appendix"><summary>실행 환경 · 기준 버전</summary><dl>
    ${metadata.map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join('')}
    <dt>기준 버전</dt><dd>${escape(performance.policyVersion)}</dd><dt>적용 프로필</dt><dd>${escape(performance.profile)}</dd>
  </dl></details>
  <details class="appendix"><summary>준비 실행 ${warmup.length}개 · 본 판정에서 제외</summary><div class="table-scroll"><table>
    <thead><tr><th>환경</th><th>기능</th><th>시간 ms</th></tr></thead><tbody>
      ${warmup.map(sample => `<tr><td>${escape(projectName(sample.project))}</td><td>${escape(sample.label ?? sample.metric)}</td><td>${number(sample.durationMs)}</td></tr>`).join('')}
    </tbody></table></div></details>
  <footer>독립 HTML 보고서 · 인터넷 연결 없이 열 수 있습니다. 원본 JSON의 판정과 표본을 그대로 표시합니다.</footer>
</main><script>${filterScript}</script></body></html>`;
}

const styles = `
:root{color-scheme:light;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#172b43;background:#f4f6fa;font-size:14px}
*{box-sizing:border-box}body{margin:0}main{max-width:1500px;margin:auto;padding:40px 32px}h1,h2,p{margin:0}h1{font-size:32px;letter-spacing:-1px;margin:8px 0 12px}h2{font-size:17px}
.eyebrow{font-size:11px;font-weight:800;letter-spacing:2px;color:#416cd0}.intro{color:#53657c;line-height:1.6}.metadata{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px;color:#617187;font-size:12px}.metadata>*{padding:5px 9px;background:#e9eef7;border-radius:6px}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:28px 0 20px}.cards article{background:white;border:1px solid #dfe5ee;border-radius:14px;padding:20px}.cards h2{font-size:13px;font-weight:600;color:#52647c;margin-bottom:12px}.cards p{font-size:12px;color:#617187;margin-top:12px}.cards .badge,.coverage{font-size:20px;font-weight:750}.coverage{display:inline-block;padding:4px 0}.good{color:#116b4c}.bad{color:#b42c38}
.badge{display:inline-block;border-radius:6px;padding:4px 8px;font-size:12px;font-weight:700;white-space:nowrap}.pass{color:#116b4c;background:#e6f6ed}.fail{color:#a42635;background:#ffebee}.neutral{color:#765010;background:#fff2d5}
.policy{background:#edf3ff;border:1px solid #d8e4fb;border-radius:12px;padding:20px 24px;margin-bottom:26px}.policy h2{color:#254e97}.policy ol{display:flex;flex-wrap:wrap;gap:12px 32px;padding-left:20px;line-height:1.7}.policy p{font-size:12px;line-height:1.7;color:#455f85;margin-top:5px}.notice{padding:18px 22px;background:#fff4dc;border-radius:12px;margin:18px 0;line-height:1.7}.notice.error{background:#fff0f1;border:1px solid #f1c8ce}.notice h2{margin-bottom:8px}.notice li{overflow-wrap:anywhere}
.results-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:24px 0 16px}.results-heading span{font-size:12px;color:#65768b}.filters{display:flex;gap:12px;margin:0 0 18px}.filters label{display:flex;flex-direction:column;gap:6px;font-size:12px;color:#52647c}.filters select,.filters input{font:inherit;font-size:14px;color:#243951;border:1px solid #ced7e5;border-radius:8px;padding:10px 12px;background:white;min-height:42px}.filters select{min-width:180px}.filters .search{flex:1}.filters input{width:100%}:focus-visible{outline:3px solid #77a7ff;outline-offset:2px}
.table-scroll{overflow:auto;background:white;border:1px solid #dfe5ee;border-radius:12px}table{border-collapse:collapse;text-align:left;width:100%;min-width:1100px}caption{text-align:left;padding:12px 18px;font-size:12px;color:#60728a;border-bottom:1px solid #e4eaf2}thead{background:#eef2f8}th{padding:14px 16px;color:#50627a;font-size:12px;white-space:nowrap}td{padding:17px 16px;border-top:1px solid #e8edf4;vertical-align:top;font-size:13px}tbody tr:hover{background:#fafcff}td:first-child{width:34%;min-width:320px}.project{display:block;font-size:11px;color:#60718a;margin-bottom:6px}.metric{display:block;line-height:1.5;font-size:14px}code{display:block;font-size:11px;color:#6b7b91;overflow-wrap:anywhere;margin-top:4px}.timing{white-space:nowrap;font-variant-numeric:tabular-nums}.timing strong{font-size:17px;font-weight:700}.limit{display:block;font-size:12px;color:#47617f;margin-top:7px}.exceeded{background:#fff0f1;color:#b02b39}.exceeded .limit{color:#9b4350}.reason{color:#a12b38;font-size:11px;line-height:1.6;margin-top:8px}
details{font-size:12px;line-height:1.6}summary{cursor:pointer;color:#345da0;font-weight:600}.samples{margin-top:10px}.samples p{margin-top:8px}.sample-values{display:flex;flex-wrap:wrap;gap:4px}.sample-values span{padding:2px 5px;background:#edf1f7;border-radius:4px;font-variant-numeric:tabular-nums}.cache{color:#718096;overflow-wrap:anywhere}.ux-cell{min-width:150px}.ux-cell details{margin-top:8px}.ux-cell small{display:block;color:#64758b;margin-top:8px;font-size:10px}.ux-cell dl{display:block;margin:8px 0}.ux-cell dd{margin:0 0 5px}.appendix{background:white;border:1px solid #dfe5ee;border-radius:12px;padding:18px 20px;margin-top:18px}.appendix summary{font-size:14px}.appendix dl{display:grid;grid-template-columns:140px 1fr;gap:10px;margin-bottom:0}.appendix dt{color:#687990}.appendix dd{margin:0;overflow-wrap:anywhere}.appendix table{min-width:600px}.appendix .table-scroll{margin-top:16px}.empty{text-align:center;padding:24px;color:#63758c}footer{text-align:center;color:#738096;font-size:12px;margin-top:28px;line-height:1.7}[hidden]{display:none!important}
@media(max-width:760px){main{padding:24px 16px}h1{font-size:26px}.cards{grid-template-columns:repeat(2,1fr);gap:10px}.cards article{padding:16px}.filters{flex-wrap:wrap}.filters label{flex:1;min-width:130px}.filters select{min-width:0;width:100%}.filters .search{flex-basis:100%}.policy{padding:18px}.policy ol{display:block}.policy li{margin:6px 0}.appendix dl{grid-template-columns:90px 1fr}.results-heading h2{font-size:16px}}
@media print{body{background:white}main{max-width:none;padding:0}.filters{display:none}.table-scroll{overflow:visible}table{min-width:0;font-size:10px}td:first-child{min-width:0}th,td{padding:8px}.cards{break-inside:avoid}.policy{break-inside:avoid}thead{display:table-header-group}tr{break-inside:avoid}}
`;

const filterScript = `
const rows = [...document.querySelectorAll('tr[data-project]')];
const project = document.getElementById('project-filter');
const status = document.getElementById('status-filter');
const query = document.getElementById('metric-filter');
function filterRows() {
  const keyword = query.value.trim().toLowerCase();
  let count = 0;
  for (const row of rows) {
    const matchesStatus = !status.value || (status.value === 'attention' ? row.dataset.status !== 'pass' : row.dataset.ux === 'fail');
    const visible = (!project.value || project.value === row.dataset.project) && matchesStatus && row.dataset.search.includes(keyword);
    row.hidden = !visible;
    if (visible) count++;
  }
  document.getElementById('visible-count').textContent = count + ' / ' + rows.length + '개 경로';
  document.getElementById('empty').hidden = count !== 0;
}
project.addEventListener('change', filterRows);
status.addEventListener('change', filterRows);
query.addEventListener('input', filterRows);
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

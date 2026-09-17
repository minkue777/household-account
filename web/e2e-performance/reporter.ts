import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cpus, platform, release, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { markdownTable } from '../../tools/performance/statistics.mjs';
import { budgetMarkdown, evaluatePerformanceBudgets } from '../../tools/performance/budgets.mjs';
import { WEB_PERFORMANCE_METRICS } from './metrics';

export default class PerformanceReporter implements Reporter {
  private samples: any[] = [];
  private failures: string[] = [];
  private fixtures: any[] = [];
  private pwaPreparation: any[] = [];
  private phaseDiagnostics: any[] = [];
  private selectedProjects: string[] = [];
  private reportingErrors: string[] = [];
  onBegin(_config: FullConfig, suite: Suite) {
    this.selectedProjects = Array.from(new Set(suite.allTests().map(test => test.parent.project()?.name)
      .filter((name): name is string => name !== undefined)));
  }
  onTestEnd(test: TestCase, result: TestResult) {
    for (const attachment of result.attachments) {
      if (!['performance-sample', 'performance-fixture', 'performance-pwa-preparation', 'performance-phase-diagnostics'].includes(attachment.name)) continue;
      try {
        if (!attachment.body) throw new Error('Missing attachment body');
        const value = JSON.parse(attachment.body.toString());
        if (attachment.name === 'performance-sample') this.samples.push(value);
        if (attachment.name === 'performance-fixture') this.fixtures.push(value);
        if (attachment.name === 'performance-pwa-preparation') this.pwaPreparation.push({ project: test.parent.project()?.name, ...value });
        if (attachment.name === 'performance-phase-diagnostics') this.phaseDiagnostics.push(value);
      } catch (error) {
        this.reportingErrors.push(`${test.parent.project()?.name}/${attachment.name}: ${String(error)}`);
      }
    }
    if (result.status !== 'passed') {
      this.failures.push(test.titlePath().join(' > '));
      const failureOutput = resolve(process.cwd(), 'performance-results/failures');
      mkdirSync(failureOutput, { recursive: true });
      for (const attachment of result.attachments) {
        if (!attachment.name.startsWith('failure-') || !attachment.body) continue;
        const name = `${test.parent.project()?.name}-${attachment.name}`.replace(/[^a-zA-Z0-9._-]/g, '_');
        try { writeFileSync(resolve(failureOutput, name), attachment.body); }
        catch (error) { this.reportingErrors.push(`Failure artifact: ${String(error)}`); }
      }
    }
  }
  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] }> {
    // Playwright deliberately swallows reporter exceptions. Explicitly return a
    // failed status when the report is incomplete or cannot be written.
    try { return this.writeReport(result); }
    catch (error) {
      console.error(`Performance report failed: ${String(error)}`);
      return { status: 'failed' };
    }
  }
  private writeReport(result: FullResult): { status: FullResult['status'] } {
    const output = resolve(process.cwd(), 'performance-results');
    mkdirSync(output, { recursive: true });
    const samplesRequested = Number(process.env.PERFORMANCE_SAMPLES ?? 7);
    const performance = evaluatePerformanceBudgets(this.samples, { projects: this.selectedProjects,
      metrics: WEB_PERFORMANCE_METRICS, samplesPerMetric: samplesRequested, reportOnly: true,
      diagnostic: process.env.PERFORMANCE_DIAGNOSTIC === 'true', ci: Boolean(process.env.CI || process.env.GITHUB_ACTIONS),
      profile: process.env.PERFORMANCE_PROFILE });
    const statistics = performance.statistics;
    const errors = [...this.reportingErrors, ...performance.errors];
    const status: FullResult['status'] = result.status === 'passed' && (performance.status === 'fail' || errors.length > 0 || this.failures.length > 0)
      ? 'failed' : result.status;
    const reportStatus = status === 'passed' ? performance.status : status;
    const report = { schemaVersion: 'household-performance.v1', status: reportStatus, testStatus: result.status, timestamp: new Date().toISOString(),
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      workingTreeDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
      environment: { os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, logicalCpus: cpus().length, node: process.version,
        totalMemoryBytes: totalmem(), runnerOs: process.env.RUNNER_OS, runnerArch: process.env.RUNNER_ARCH,
        runnerImage: process.env.ImageOS, runnerImageVersion: process.env.ImageVersion, job: process.env.GITHUB_JOB,
        backend: 'local Firebase Auth/Functions/Firestore emulators', build: 'production Next.js', workers: 1,
        realDevice: false, playwright: JSON.parse(readFileSync(resolve(process.cwd(), 'node_modules/@playwright/test/package.json'), 'utf8')).version,
        samplesRequested, warmupPerScenario: 1 },
      coverage: { projects: this.selectedProjects, metrics: WEB_PERFORMANCE_METRICS, complete: performance.coverage.complete && this.reportingErrors.length === 0,
        errors: [...this.reportingErrors, ...performance.coverage.errors] },
      performance, fixtures: this.fixtures, pwaPreparation: this.pwaPreparation,
      ...(this.phaseDiagnostics.length > 0 ? { phaseDiagnostics: this.phaseDiagnostics } : {}),
      failures: this.failures, statistics, samples: this.samples };
    writeFileSync(resolve(output, 'web.json'), JSON.stringify(report, null, 2) + '\n');
    const validation = report.coverage.complete ? `표본 완전성: 선택된 환경마다 ${WEB_PERFORMANCE_METRICS.length}개 지표 × ${samplesRequested}회와 준비 실행 1회를 확인했습니다.`
      : `표본 검증 실패 ${report.coverage.errors.length}건입니다. 아래 값은 불완전한 측정이며 전체 기준선으로 사용할 수 없습니다. 상세 오류는 web.json의 coverage.errors에 기록했습니다.`;
    const markdown = `# 핵심 기능 성능 측정\n\n상태: ${reportStatus}. 로컬 에뮬레이터의 합성 데이터 측정이며 실제 휴대폰·운영 네트워크 시간과 다릅니다.\n\n${validation}\n\n${budgetMarkdown(performance)}\n\n${markdownTable(statistics)}\n`;
    writeFileSync(resolve(output, 'web.md'), markdown);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    if (errors.length > 0) console.error(`Performance validation failed (${errors.length}):\n${errors.slice(0, 10).join('\n')}`);
    if (performance.exceededMetrics.length > 0) console.log(`Performance reference exceeded (report only):\n${performance.exceededMetrics.join('\n')}`);
    return { status };
  }
}

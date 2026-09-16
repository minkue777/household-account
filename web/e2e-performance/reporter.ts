import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cpus, platform, release } from 'node:os';
import { resolve } from 'node:path';
import { summarizeSamples, markdownTable, validateSampleCoverage } from '../../tools/performance/statistics.mjs';
import { WEB_PERFORMANCE_METRICS } from './metrics';

export default class PerformanceReporter implements Reporter {
  private samples: any[] = [];
  private failures: string[] = [];
  private fixtures: any[] = [];
  private pwaPreparation: any[] = [];
  private selectedProjects: string[] = [];
  private reportingErrors: string[] = [];
  onBegin(_config: FullConfig, suite: Suite) {
    this.selectedProjects = Array.from(new Set(suite.allTests().map(test => test.parent.project()?.name)
      .filter((name): name is string => name !== undefined)));
  }
  onTestEnd(test: TestCase, result: TestResult) {
    for (const attachment of result.attachments) {
      if (!['performance-sample', 'performance-fixture', 'performance-pwa-preparation'].includes(attachment.name)) continue;
      try {
        if (!attachment.body) throw new Error('Missing attachment body');
        const value = JSON.parse(attachment.body.toString());
        if (attachment.name === 'performance-sample') this.samples.push(value);
        if (attachment.name === 'performance-fixture') this.fixtures.push(value);
        if (attachment.name === 'performance-pwa-preparation') this.pwaPreparation.push({ project: test.parent.project()?.name, ...value });
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
    const coverageErrors = validateSampleCoverage(this.samples, { projects: this.selectedProjects,
      metrics: WEB_PERFORMANCE_METRICS, samplesPerMetric: samplesRequested });
    let statistics: ReturnType<typeof summarizeSamples> = [];
    try { statistics = summarizeSamples(this.samples); }
    catch (error) { this.reportingErrors.push(`Statistics: ${String(error)}`); }
    const errors = [...this.reportingErrors, ...coverageErrors];
    const status: FullResult['status'] = result.status === 'passed' && (errors.length > 0 || this.failures.length > 0)
      ? 'failed' : result.status;
    const report = { schemaVersion: 'household-performance.v1', status, timestamp: new Date().toISOString(),
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      workingTreeDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
      environment: { os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, logicalCpus: cpus().length, node: process.version,
        backend: 'local Firebase Auth/Functions/Firestore emulators', build: 'production Next.js', workers: 1,
        realDevice: false, playwright: JSON.parse(readFileSync(resolve(process.cwd(), 'node_modules/@playwright/test/package.json'), 'utf8')).version,
        samplesRequested, warmupPerScenario: 1 },
      coverage: { projects: this.selectedProjects, metrics: WEB_PERFORMANCE_METRICS, complete: errors.length === 0, errors },
      fixtures: this.fixtures, pwaPreparation: this.pwaPreparation, failures: this.failures, statistics, samples: this.samples };
    writeFileSync(resolve(output, 'web.json'), JSON.stringify(report, null, 2) + '\n');
    const validation = errors.length === 0 ? `표본 완전성: 선택된 환경마다 ${WEB_PERFORMANCE_METRICS.length}개 지표 × ${samplesRequested}회와 준비 실행 1회를 확인했습니다.`
      : `표본 검증 실패 ${errors.length}건입니다. 아래 값은 불완전한 측정이며 전체 기준선으로 사용할 수 없습니다. 상세 오류는 web.json의 coverage.errors에 기록했습니다.`;
    const markdown = `# 핵심 기능 성능 측정\n\n상태: ${status}. 로컬 에뮬레이터의 합성 데이터 측정이며 실제 휴대폰·운영 네트워크 시간과 다릅니다. 준비 실행은 통계에서 제외합니다.\n\n${validation}\n\n${markdownTable(statistics)}\n\n시간 임계값은 현재 관찰 단계입니다. UI/저장 정합성 및 30초 완료 제한은 검사하며, CI 기준선 없이 로컬 수치를 CI 실패 기준으로 사용하지 않습니다.\n`;
    writeFileSync(resolve(output, 'web.md'), markdown);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    if (errors.length > 0) console.error(`Performance coverage failed (${errors.length}):\n${errors.slice(0, 10).join('\n')}`);
    return { status };
  }
}

import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../../../tools/ci/quality-summary.mjs', import.meta.url));
const jobs = ['functions', 'web', 'web-e2e', 'android', 'android-instrumentation'];
const sha = 'a'.repeat(40);
const runUrl = 'https://github.com/example/household/actions/runs/123';

function run(results: Record<string, { result: string }>, commit = sha) {
  const summary = join(mkdtempSync(join(tmpdir(), 'household-ci-summary-')), 'summary.md');
  const execution = spawnSync(process.execPath, [script], { encoding: 'utf8', windowsHide: true,
    env: { ...process.env, QUALITY_JOB_RESULTS: JSON.stringify(results), GITHUB_SHA: commit,
      GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'example/household', GITHUB_RUN_ID: '123', GITHUB_STEP_SUMMARY: summary } });
  return { execution, summary };
}

describe('실제 독립 CI 결과 CLI', () => {
  it('[T-REL-001][REL-001] 다섯 job의 성공을 실제 요약 파일에 기록하고 배포 결과와 분리한다', () => {
    const { execution, summary } = run(Object.fromEntries(jobs.map(name => [name, { result: 'success' }])));
    expect(execution.error).toBeUndefined();
    expect(execution.status).toBe(0);
    expect(JSON.parse(execution.stdout)).toMatchObject({ commitSha: sha, runUrl, conclusion: 'success' });
    const text = readFileSync(summary, 'utf8');
    expect(text).toContain(sha);
    expect(text).toContain(runUrl);
    expect(text).toContain('배포와 별개');
    for (const name of jobs) expect(text).toContain(`| ${name} | success |`);
  });
  it.each(['failure', 'cancelled', 'skipped', 'in_progress', 'missing'])('[T-REL-001][REL-001] %s는 CI 실패 exit code와 annotation으로 남기며 성공으로 축약하지 않는다', status => {
    const results = Object.fromEntries(jobs.map(name => [name, { result: 'success' }]));
    if (status === 'missing') delete results['web-e2e']; else results['web-e2e'] = { result: status };
    const { execution, summary } = run(results);
    expect(execution.status).toBe(1);
    expect(JSON.parse(execution.stdout)).toMatchObject({ conclusion: 'failure', jobs: expect.arrayContaining([{ name: 'web-e2e', result: ['in_progress', 'missing'].includes(status) ? 'missing' : status }]) });
    expect(execution.stderr).toContain('::error title=CI web-e2e::');
    expect(readFileSync(summary, 'utf8')).toContain('이미 배포된 경우 영향도와 배포 상태를 별도로 확인');
  });
  it('[T-REL-001][REL-001] 증거가 없는 결과와 잘못된 commit을 성공 처리하지 않는다', () => {
    expect(run({}).execution.status).toBe(1);
    const { execution } = run({}, 'different-head');
    expect(execution.status).toBe(1);
    expect(execution.stderr).toContain('QUALITY_COMMIT_REQUIRED');
  });
});

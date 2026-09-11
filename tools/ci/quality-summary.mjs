import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const qualityJobs = ['functions', 'web', 'web-e2e', 'android', 'android-instrumentation'];

export function qualitySummary(needs, commitSha, runUrl) {
  if (!/^[a-f0-9]{40}$/i.test(commitSha ?? '')) throw new Error('QUALITY_COMMIT_REQUIRED');
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+$/.test(runUrl ?? '')) throw new Error('QUALITY_RUN_URL_REQUIRED');
  const jobs = qualityJobs.map(name => {
    const result = needs?.[name]?.result;
    return { name, result: ['success', 'failure', 'cancelled', 'skipped'].includes(result) ? result : 'missing' };
  });
  const failed = jobs.filter(job => job.result !== 'success');
  const conclusion = failed.length ? 'failure' : 'success';
  const markdown = [
    '## 독립 CI 결과', '',
    `커밋: \`${commitSha}\` · [실행 로그](${runUrl})`, '',
    '이 결과는 배포와 별개입니다. CI는 배포 완료 여부를 판단하거나 자동 rollback을 실행하지 않습니다.', '',
    '| 검증 | 결과 |', '|---|---|',
    ...jobs.map(job => `| ${job.name} | ${job.result} |`), '',
    failed.length ? '실패·취소·누락된 검증을 확인하고 수정해야 합니다. 이미 배포된 경우 영향도와 배포 상태를 별도로 확인합니다.' : '다섯 검증이 모두 성공했습니다.', '',
  ].join('\n');
  return { commitSha, runUrl, conclusion, jobs, failed, markdown };
}

function main() {
  const result = qualitySummary(JSON.parse(process.env.QUALITY_JOB_RESULTS ?? '{}'), process.env.GITHUB_SHA,
    `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.markdown, 'utf8');
  console.log(JSON.stringify({ commitSha: result.commitSha, runUrl: result.runUrl, conclusion: result.conclusion, jobs: result.jobs }));
  for (const job of result.failed) console.error(`::error title=CI ${job.name}::${job.result}; ${result.runUrl}`);
  if (result.conclusion !== 'success') process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

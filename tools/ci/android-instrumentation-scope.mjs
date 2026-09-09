import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ANDROID_PREFIXES = ['android/', 'contracts/', 'web/src/platform/android-host/'];
const ANDROID_WEB_FILES = new Set([
  'web/src/lib/bridges/androidBridge.ts',
  'web/src/lib/authService.ts',
  'web/src/lib/firebase.ts',
]);

export function affectsAndroidRuntime(path) {
  return ANDROID_PREFIXES.some(prefix => path.startsWith(prefix)) || ANDROID_WEB_FILES.has(path);
}

function requireSha(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/i.test(value)) {
    throw new Error('ANDROID_SCOPE_COMMIT_REQUIRED');
  }
  return value;
}

export function androidInstrumentationScope(eventName, event, git = args =>
  execFileSync('git', args, { encoding: 'utf8' })
) {
  if (eventName === 'workflow_dispatch') return { required: true, reason: '수동 전체 검증' };
  if (!['push', 'pull_request'].includes(eventName)) throw new Error('ANDROID_SCOPE_EVENT_UNSUPPORTED');

  const head = requireSha(eventName === 'push' ? event.after : event.pull_request?.head?.sha);
  const base = requireSha(eventName === 'push' ? event.before : event.pull_request?.base?.sha);
  let paths;
  if (/^0{40}$/.test(base)) {
    paths = git(['ls-tree', '-r', '--name-only', '-z', head]);
  } else {
    const comparisonBase = eventName === 'pull_request'
      ? requireSha(git(['merge-base', base, head]).trim())
      : base;
    // push의 모든 커밋을 비교하고, 이름 변경도 이전 경로의 삭제로 판정합니다.
    paths = git(['diff', '--no-renames', '--name-only', '-z', comparisonBase, head]);
  }
  const required = paths.split('\0').filter(Boolean).some(affectsAndroidRuntime);
  return {
    required,
    reason: required ? 'Android 코드·공용 계약·연동 변경' : 'Android 관련 변경 없음 — 에뮬레이터 검증 대상 아님',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const result = androidInstrumentationScope(process.env.GITHUB_EVENT_NAME, event);
  appendFileSync(process.env.GITHUB_OUTPUT, `required=${result.required}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Android 에뮬레이터: ${result.reason}\n`);
  }
  console.log(result.reason);
}

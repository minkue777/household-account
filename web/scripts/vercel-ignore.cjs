const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

function affectsWeb(path) {
  if (path.startsWith('contracts/')) return true;
  if (['.vercelignore', '.npmrc', 'package.json', 'package-lock.json', 'vercel.json'].includes(path)) return true;
  if (!path.startsWith('web/')) return false;
  return !/(?:^|\/)(?:__tests__|__mocks__|e2e|test-results|playwright-report)\//.test(path)
    && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)
    && !/^web\/(?:jest[^/]*|playwright[^/]*|README\.md)$/.test(path);
}

function shouldBuild(env = process.env, git = args => execFileSync('git', args, { cwd: resolve(__dirname, '../..'), encoding: 'utf8' })) {
  const base = env.VERCEL_GIT_PREVIOUS_SHA;
  const head = env.VERCEL_GIT_COMMIT_SHA;
  // Missing previous deployment or shallow history must build, never hide a change.
  if (![base, head].every(value => /^[a-f0-9]{40}$/i.test(value || '')) || base === head) return true;
  try {
    return git(['diff', '--no-renames', '--name-only', '-z', base, head, '--']).split('\0').filter(Boolean).some(affectsWeb);
  } catch {
    return true;
  }
}

module.exports = { affectsWeb, shouldBuild };
if (require.main === module) {
  const build = shouldBuild();
  console.log(build ? 'Web 배포 대상 변경 또는 비교 기준 없음: 빌드 진행' : 'Web 실행 파일 변경 없음: 빌드 생략');
  // Vercel's Ignored Build Step uses 0 to skip, 1 to build.
  process.exitCode = build ? 1 : 0;
}

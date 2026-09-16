import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIREBASE_TARGETS, firebaseTargetsForPaths, planFirebaseDeployment, requireFirebaseDeploymentScope } from '../../scripts/firebase-deploy-scope.mjs';

const require = createRequire(import.meta.url);
const { shouldBuild } = require('../../../web/scripts/vercel-ignore.cjs');
const head = 'b'.repeat(40);
const base = 'a'.repeat(40);
const manifest = { releaseId: 'next', artifacts: [{ sha256: 'new-artifact' }] };
const previous = { record: { status: 'completed', smoke: { status: 'passed' }, releaseId: 'old', commitSha: base, artifact: { sha256: 'old-artifact' } } };

describe('실제 배포 대상 선택', () => {
  it.each([
    [['web/src/components/assets/CryptoHoldingList.tsx'], []],
    [['functions/scripts/deploy-firebase.mjs', 'functions/test/bootstrap/deployment-scope.test.ts', 'docs/operations/firebase-release-runbook.md'], []],
    [['functions/src/operations/scheduling/dividendScheduledPages.ts'], FIREBASE_TARGETS.slice(0, 3)],
    [['functions-payment-capture/index.js'], ['functions:payment-capture']],
    [['functions-access-session/package-lock.json'], ['functions:access-session']],
    [['firestore.rules'], ['firestore:rules']],
    [['firestore.indexes.json'], ['firestore:indexes']],
    [['storage.rules'], ['storage']],
    [['contracts/fixtures/operations/scheduled-jobs.v1.json'], FIREBASE_TARGETS.slice(0, 3)],
    [['firebase.json'], FIREBASE_TARGETS],
  ])('%j의 필요한 Firebase 리소스만 선택한다', (paths, targets) => {
    expect(firebaseTargetsForPaths(paths)).toEqual(targets);
  });

  it('Rules만 배포하면 기존 Query marker를 확인하고, 이후 partial 배포에도 계승한다', () => {
    const rules = planFirebaseDeployment({ head, previous, manifest }, () => 'firestore.rules\0');
    expect(rules.targets).toEqual(['firestore:rules']);
    expect(rules.queryDeployment).toEqual({ releaseId: 'old', commitSha: base, artifactSha256: 'old-artifact' });
    const next = planFirebaseDeployment({ head: 'c'.repeat(40), manifest, previous: { record: { ...previous.record, releaseId: 'rules', commitSha: head }, scope: rules } }, () => 'storage.rules\0');
    expect(next.queryDeployment).toEqual(rules.queryDeployment);
    const runtime = planFirebaseDeployment({ head, previous, manifest }, () => 'functions/src/index.ts\0');
    expect(runtime.queryDeployment).toEqual({ releaseId: 'next', commitSha: head, artifactSha256: 'new-artifact' });
  });

  it('저장소가 object key 순서를 바꾸어도 같은 범위는 허용하고 누락된 대상·다른 기준은 차단한다', () => {
    const scope = planFirebaseDeployment({ head, previous, manifest }, () => 'firestore.rules\0');
    const stored = { queryDeployment: { artifactSha256: 'old-artifact', commitSha: base, releaseId: 'old' }, targets: ['firestore:rules'], baseCommitSha: base, baseReleaseId: 'old' };
    expect(() => requireFirebaseDeploymentScope(stored, scope, 'firestore:rules')).not.toThrow();
    expect(() => requireFirebaseDeploymentScope(stored, scope, 'storage')).toThrow('DEPLOY_SCOPE_CHANGED');
    expect(() => requireFirebaseDeploymentScope({ ...stored, baseReleaseId: 'other' }, scope, 'firestore:rules')).toThrow('DEPLOY_SCOPE_CHANGED');
  });

  it('초기 배포와 명시적 복구는 전체 범위이고, 실패 기록이나 없는 Git 이력을 생략으로 처리하지 않는다', () => {
    expect(planFirebaseDeployment({ head, manifest }).targets).toEqual(FIREBASE_TARGETS);
    const failed = { record: { ...previous.record, status: 'failed' } };
    expect(() => planFirebaseDeployment({ head, previous: failed, manifest })).toThrow('PREVIOUS_DEPLOYMENT_NOT_SUCCESSFUL');
    expect(planFirebaseDeployment({ head, previous: failed, manifest, deployAll: true }).targets).toEqual(FIREBASE_TARGETS);
    expect(() => planFirebaseDeployment({ head, previous, manifest }, () => { throw new Error('missing git object'); })).toThrow('missing git object');
    expect(shouldBuild({ VERCEL_GIT_COMMIT_SHA: head })).toBe(true);
    expect(shouldBuild({ VERCEL_GIT_COMMIT_SHA: head, VERCEL_GIT_PREVIOUS_SHA: base }, () => { throw new Error('shallow'); })).toBe(true);
  });

  it('실제 Git에서 마지막 성공 배포 이후 여러 커밋과 삭제·이동된 실행 파일을 놓치지 않는다', () => {
    const directory = mkdtempSync(join(tmpdir(), 'household-deploy-scope-'));
    const git = (args: string[]) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', windowsHide: true }).trim();
    git(['init', '--quiet']);
    git(['config', 'user.name', 'Scope Test']); git(['config', 'user.email', 'scope@example.test']);
    const write = (path: string, content: string) => { mkdirSync(dirname(join(directory, path)), { recursive: true }); writeFileSync(join(directory, path), content); };
    const commit = () => { git(['add', '.']); git(['commit', '--quiet', '-m', 'fixture']); return git(['rev-parse', 'HEAD']); };
    write('web/src/page.tsx', 'old'); write('functions/src/index.ts', 'old');
    const baseline = commit();
    write('web/e2e/page.spec.ts', 'test'); write('docs/note.md', 'docs');
    let current = commit();
    const env = () => ({ VERCEL_GIT_PREVIOUS_SHA: baseline, VERCEL_GIT_COMMIT_SHA: current });
    expect(shouldBuild(env(), git)).toBe(false);
    write('web/src/page.tsx', 'changed'); current = commit();
    write('docs/note.md', 'later docs'); current = commit();
    expect(shouldBuild(env(), git)).toBe(true);
    git(['mv', 'functions/src/index.ts', 'docs/old-server.txt']); current = commit();
    const result = planFirebaseDeployment({ head: current, previous: { record: { ...previous.record, commitSha: baseline } }, manifest }, git);
    expect(result.targets).toEqual(FIREBASE_TARGETS.slice(0, 3));
  });
});

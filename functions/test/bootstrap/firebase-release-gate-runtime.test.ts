import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeploymentTargetCompatibilityApplication } from '../../src/platform/delivery-assurance/application/deploymentTargetCompatibilityApplication';
import { createReleaseCandidateEvaluationApplication } from '../../src/platform/delivery-assurance/application/releaseCandidateEvaluationApplication';
import { readDeploymentMarker } from '../../src/bootstrap/deploymentMarker';

describe('[REL-001][REL-002][REL-003] 실제 배포 wrapper의 실패 차단', () => {
  afterEach(() => vi.restoreAllMocks());
  const scripts = () => Promise.all([import('../../scripts/deploy-firebase.mjs'), import('../../scripts/release-evidence.mjs')]);
  const sha = 'a'.repeat(40);
  const run = { headSha: sha, status: 'completed', conclusion: 'success', event: 'push' };
  const jobs = ['functions', 'web', 'web-e2e', 'android', 'android-instrumentation'].map(name => ({ name, conclusion: 'success' }));
  it.each([
    { verificationStatus: 'VERIFIED', enabled: true, expected: true },
    { verificationStatus: 'VERIFICATION_STATUS_UNSPECIFIED', enabled: true, expected: true },
    { verificationStatus: undefined, enabled: true, expected: true },
    { verificationStatus: 'UNVERIFIED', enabled: true, expected: false },
    { verificationStatus: 'VERIFIED', enabled: false, expected: false },
    { verificationStatus: 'unknown-new-status', enabled: true, expected: false },
  ])('Monitoring 실제 GET 응답의 활성·검증 상태를 해석한다: $verificationStatus / $enabled', async ({ verificationStatus, enabled, expected }) => {
    const [script] = await scripts();
    const resource = 'projects/household-account-6f300/notificationChannels/channel-1';
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ name: resource, enabled, verificationStatus })));
    await expect(script.verifyCloudResource({ getAccessToken: async () => ({ access_token: 'test-credential' }) }, resource, 'monitoring.googleapis.com')).resolves.toBe(expected);
    expect(request).toHaveBeenCalledWith(`https://monitoring.googleapis.com/v3/${resource}`, expect.objectContaining({ headers: { authorization: 'Bearer test-credential' } }));
  });
  it('Monitoring 권한 오류와 다른 채널 응답은 배포 허가로 사용하지 않는다', async () => {
    const [script] = await scripts();
    const resource = 'projects/household-account-6f300/notificationChannels/channel-1';
    const credential = { getAccessToken: async () => ({ access_token: 'test-credential' }) };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'different-channel', enabled: true, verificationStatus: 'VERIFIED' })));
    await expect(script.verifyCloudResource(credential, resource, 'monitoring.googleapis.com')).rejects.toThrow('MONITORING_CHANNEL_UNAVAILABLE');
    await expect(script.verifyCloudResource(credential, resource, 'monitoring.googleapis.com')).resolves.toBe(false);
  });
  it.each(['pending', 'failure', 'cancelled', 'skipped', 'missing'])('정확한 HEAD의 완료 success 이외 CI 상태(%s)는 차단한다', async status => {
    const [, script] = await scripts();
    const candidate = status === 'missing' ? [] : [{ ...run, conclusion: status, status: status === 'pending' ? 'in_progress' : 'completed' }];
    expect(() => script.requireSuccessfulHeadRun(candidate, sha, jobs)).toThrow('EXACT_HEAD_QUALITY_GATES_REQUIRED');
    expect(() => script.requireSuccessfulHeadRun([run], 'b'.repeat(40), jobs)).toThrow('EXACT_HEAD_QUALITY_GATES_REQUIRED');
  });
  it('성공 CI라도 필수 surface job이 빠지면 허용하지 않는다', async () => {
    const [, script] = await scripts();
    expect(() => script.requireSuccessfulHeadRun([run], sha, jobs.slice(1))).toThrow('QUALITY_JOB_REQUIRED');
    expect(script.requireSuccessfulHeadRun([run], sha, jobs)).toEqual(run);
  });
  it('활성 테스트가 skip이면 실제 보고서로부터 계산한 Domain gate가 배포를 거부한다', async () => {
    const [, script] = await scripts();
    const report = { testResults: ['test/architecture/requirement-test-traceability', 'test/architecture/document-relative-links', 'test/architecture/production-dependency-direction', 'test/contexts/core'].map(name => ({ name: `/repo/functions/${name}`, assertionResults: [{ status: name.endsWith('core') ? 'pending' : 'passed' }] })) };
    const web = { testResults: [{ name: 'web-test', assertionResults: [{ status: 'passed' }] }] };
    const evidence = script.releaseGateEvidence(report, web, { active: 1, passed: 1, failed: 0, skipped: 0, knownFailures: 0 });
    const result = await createReleaseCandidateEvaluationApplication({ evidence: { collect: async () => evidence }, manifestHash: { hash: () => 'manifest' } }).evaluate({} as never);
    expect(result).toMatchObject({ kind: 'rejected', failed: [{ gate: 'active-contract-tests', code: 'GATE_FAILED' }] });
  });
  it('dirty workspace와 변경 artifact를 policy 호출 전에 차단한다', async () => {
    const [script] = await scripts();
    const hashes = { dependencyLockHash: 'l', contractHash: 'c', rulesHash: 'r', indexesHash: 'i', artifact: { name: 'firebase-functions', sha256: 'a' } };
    const manifest = { releaseId: 'release-1', environment: 'production', contractVersion: 'v1', compatibility: { releaseId: 'release-1' }, firebaseProjectId: 'household-account-6f300', commitSha: sha, ...hashes, artifacts: [hashes.artifact] };
    const dependencies = { dirty: 'modified', head: sha, hashes, compatibility: createDeploymentTargetCompatibilityApplication(), evaluator: createReleaseCandidateEvaluationApplication({ evidence: { collect: async () => [] }, manifestHash: { hash: () => 'm' } }) };
    await expect(script.verifyCandidate(manifest, manifest.firebaseProjectId, dependencies)).rejects.toThrow('CLEAN_EXACT_HEAD_REQUIRED');
    await expect(script.verifyCandidate({ ...manifest, artifacts: [] }, manifest.firebaseProjectId, { ...dependencies, dirty: '' })).rejects.toThrow('ARTIFACT_MISMATCH');
    await expect(script.verifyCandidate(manifest, undefined, { ...dependencies, dirty: '' })).rejects.toThrow('EXPLICIT_PRODUCTION_PROJECT_REQUIRED');
    await expect(script.verifyCandidate({ ...manifest, environment: 'test' }, manifest.firebaseProjectId, dependencies)).rejects.toThrow('PRODUCTION_ENVIRONMENT_REQUIRED');
    await expect(script.verifyCandidate({ ...manifest, compatibility: { releaseId: 'other' } }, manifest.firebaseProjectId, dependencies)).rejects.toThrow('COMPATIBILITY_RELEASE_MISMATCH');
  });
  it('child codebase의 실제 배포 파일도 hash에 포함하고 marker 자체의 순환 hash는 피한다', async () => {
    const [script] = await scripts();
    const directory = mkdtempSync(join(tmpdir(), 'household-release-hash-test-'));
    for (const codebase of ['functions', 'functions-payment-capture', 'functions-access-session']) {
      mkdirSync(join(directory, codebase, 'lib'), { recursive: true });
      for (const name of ['package.json', 'package-lock.json', 'index.js']) writeFileSync(join(directory, codebase, name), '{}');
      writeFileSync(join(directory, codebase, 'lib', 'runtime.js'), 'original');
    }
    mkdirSync(join(directory, 'web')); mkdirSync(join(directory, 'contracts'));
    writeFileSync(join(directory, 'web', 'package-lock.json'), '{}');
    for (const path of ['firestore.rules', 'storage.rules', 'firestore.indexes.json']) writeFileSync(join(directory, path), '{}');
    const before = script.currentHashes(directory);
    script.writeDeploymentMarker({ releaseId: 'r1', commitSha: sha }, before.artifact, directory);
    expect(script.currentHashes(directory)).toEqual(before);
    const marker = readDeploymentMarker(join(directory, 'functions/lib/bootstrap/deployment-marker.json'));
    expect(marker).toEqual({ releaseId: 'r1', commitSha: sha, artifactSha256: before.artifact.sha256 });
    expect(() => script.requireSmokeMarker({ result: { deployment: marker } }, { releaseId: 'r1', commitSha: sha }, before.artifact)).not.toThrow();
    writeFileSync(join(directory, 'functions-payment-capture', 'lib', 'runtime.js'), 'changed child');
    expect(script.currentHashes(directory).artifact.sha256).not.toBe(before.artifact.sha256);
  });
  it('guard actor와 실제 서버 marker가 승인 candidate와 다르면 거부한다', async () => {
    const [script] = await scripts();
    const manifest = { releaseId: 'r1', commitSha: sha, authorizedActorIds: ['operator'] };
    const artifact = { sha256: 'b'.repeat(64) };
    expect(() => script.requireAuthorizedActor(manifest, 'someone-else')).toThrow('UNAUTHORIZED_RELEASE_ACTOR');
    expect(() => script.requireSmokeMarker({ result: { deployment: { releaseId: 'old-release', commitSha: sha, artifactSha256: artifact.sha256 } } }, manifest, artifact)).toThrow('SMOKE_DEPLOYMENT_MARKER_MISMATCH');
    expect(() => script.requireSmokeMarker({ result: { deployment: { releaseId: manifest.releaseId, commitSha: sha, artifactSha256: artifact.sha256 } } }, manifest, artifact)).not.toThrow();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeploymentTargetCompatibilityApplication } from '../../src/platform/delivery-assurance/application/deploymentTargetCompatibilityApplication';
import { readDeploymentMarker } from '../../src/bootstrap/deploymentMarker';

describe('[REL-001][REL-002][REL-003] 실제 배포 wrapper의 실패 차단', () => {
  afterEach(() => vi.restoreAllMocks());
  const scripts = () => Promise.all([import('../../scripts/deploy-firebase.mjs')]);
  const sha = 'a'.repeat(40);
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
  it('[T-REL-001][REL-001] 배포 후보는 CI 증거 없이 검증하고 CI 통과 결과를 만들지 않는다', async () => {
    const [script] = await scripts();
    const manifest = JSON.parse(readFileSync(new URL('../../../docs/operations/firebase-release-manifest.example.json', import.meta.url), 'utf8'));
    manifest.commitSha = sha;
    const hashes = { dependencyLockHash: manifest.dependencyLockHash, contractHash: manifest.contractHash,
      rulesHash: manifest.rulesHash, indexesHash: manifest.indexesHash, artifact: manifest.artifacts[0] };
    const result = await script.verifyCandidate(manifest, manifest.firebaseProjectId,
      { dirty: '', head: sha, hashes, compatibility: createDeploymentTargetCompatibilityApplication() });
    expect(result).toMatchObject({ kind: 'approved', deployAuthorization: { releaseId: manifest.releaseId, manifestHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      ci: { policy: 'independent', workflow: 'quality-gates.yml', commitSha: sha, status: 'not-evaluated' } });
    expect(result).not.toHaveProperty('gateResults');
    expect(result.ci).not.toHaveProperty('runId');
  });
  it('dirty workspace와 변경 artifact를 policy 호출 전에 차단한다', async () => {
    const [script] = await scripts();
    const hashes = { dependencyLockHash: 'l', contractHash: 'c', rulesHash: 'r', indexesHash: 'i', artifact: { name: 'firebase-functions', sha256: 'a' } };
    const manifest = { releaseId: 'release-1', environment: 'production', contractVersion: 'v1', compatibility: { releaseId: 'release-1' }, firebaseProjectId: 'household-account-6f300', commitSha: sha, ...hashes, artifacts: [hashes.artifact] };
    const dependencies = { dirty: 'modified', head: sha, hashes, compatibility: createDeploymentTargetCompatibilityApplication() };
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

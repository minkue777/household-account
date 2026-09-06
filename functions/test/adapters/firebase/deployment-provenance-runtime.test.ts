import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { FirebaseDeploymentProvenanceStore } from '../../../src/adapters/firebase/operations/firebaseDeploymentProvenance';
import { createDeploymentProvenanceApplication } from '../../../src/platform/delivery-assurance/application/deploymentProvenanceApplication';
import { InMemoryFirestore } from '../../support/in-memory-firestore';

describe('[REL-004] 실제 Firebase provenance adapter', () => {
  it('project lease가 같은 release를 포함한 겹치는 배포와 다른 소유자의 해제를 거부한다', async () => {
    const memory = new InMemoryFirestore();
    const store = new FirebaseDeploymentProvenanceStore(memory as unknown as Firestore);
    const project = 'household-account-6f300';
    await store.acquireDeploymentLease(project, 'owner-1', 'r1');
    await expect(store.acquireDeploymentLease(project, 'owner-2', 'r2')).rejects.toThrow('DEPLOYMENT_IN_PROGRESS');
    await expect(store.acquireDeploymentLease(project, 'owner-2', 'r1')).rejects.toThrow('DEPLOYMENT_IN_PROGRESS');
    await expect(store.requireDeploymentLease(project, undefined, 'r1')).rejects.toThrow('DEPLOYMENT_LEASE_REQUIRED');
    await expect(store.requireDeploymentLease(project, 'owner-1', 'r2')).rejects.toThrow('DEPLOYMENT_LEASE_REQUIRED');
    await expect(store.releaseDeploymentLease(project, 'owner-2')).rejects.toThrow('DEPLOYMENT_LEASE_REQUIRED');
    await expect(store.requireDeploymentLease(project, 'owner-1', 'r1')).resolves.toBeUndefined();
    expect(memory.document(`deploymentLeases/${project}`)).not.toHaveProperty('expiresAt');
    await store.releaseDeploymentLease(project, 'owner-1');
    await expect(store.acquireDeploymentLease(project, 'owner-2', 'r2')).resolves.toBeUndefined();
  });
  it('동일 release 승인·배포 재생은 한 건이고 다른 artifact 덮어쓰기를 거부하며 원문 진단·TTL을 저장하지 않는다', async () => {
    const memory = new InMemoryFirestore();
    const store = new FirebaseDeploymentProvenanceStore(memory as unknown as Firestore);
    const release = { releaseId: 'r1', manifestHash: 'm', commitSha: 'c', dependencyLockHash: 'l', contractHash: 't', rulesHash: 'r', indexesHash: 'i', projectId: 'household-account-6f300' as const, artifact: { name: 'functions', sha256: 'a' }, authorizedActorIds: ['operator'] };
    await store.approve(release, { runId: 123 });
    memory.seed('approvedReleases/r1', { release: Object.fromEntries(Object.entries(release).reverse()), evidence: { runId: 123 } });
    await expect(store.approve(release, { runId: 123 })).resolves.toBeUndefined();
    await expect(store.approve({ ...release, commitSha: 'different' }, {})).rejects.toThrow('RELEASE_APPROVAL_CONFLICT');
    const app = createDeploymentProvenanceApplication({ releases: store, records: store.records, channels: { isVerified: async () => true }, identity: { deploymentId: id => id, fingerprint: value => JSON.stringify(value) }, clock: { now: () => '2026-09-06T00:00:00Z' } });
    const input = { manifestHash: 'm', projectId: release.projectId, actorId: 'operator', artifact: release.artifact, smoke: { status: 'passed' as const, artifactSha256: 'a' }, monitoringChannelReference: `projects/${release.projectId}/notificationChannels/1`, adapterDiagnostics: [{ code: 'OK', rawMessage: 'sensitive-provider-message' }] };
    expect((await app.recordDeploymentResult('r1', input)).kind).toBe('recorded');
    expect((await app.recordDeploymentResult('r1', input)).kind).toBe('replayed');
    expect(await app.recordDeploymentResult('r1', { ...input, artifact: { ...input.artifact, sha256: 'changed' } })).toMatchObject({ kind: 'rejected', code: 'ARTIFACT_MISMATCH' });
    const record = memory.document('deploymentProvenance/r1');
    expect(JSON.stringify(record)).not.toContain('sensitive-provider-message');
    expect(JSON.stringify(record)).not.toContain('expiresAt');
    expect(memory.documentsInCollection('deploymentProvenance')).toHaveLength(1);
  });
});

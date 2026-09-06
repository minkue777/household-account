import type { Firestore } from 'firebase-admin/firestore';
import { isDeepStrictEqual } from 'node:util';
import type { ApprovedReleaseQueryPort, DeploymentRecordRepositoryPort } from '../../../platform/delivery-assurance/application/ports/out/deploymentProvenancePorts';
import type { ApprovedRelease, PublicDeploymentRecord } from '../../../platform/delivery-assurance/application/ports/in/deploymentProvenanceInputPort';

/** 배포 manifest와 provenance는 append-only이며 TTL을 두지 않습니다. */
export class FirebaseDeploymentProvenanceStore implements ApprovedReleaseQueryPort {
  constructor(private readonly db: Firestore) {}
  async acquireDeploymentLease(projectId: string, ownerToken: string, releaseId: string): Promise<void> {
    const ref = this.db.collection('deploymentLeases').doc(projectId);
    await this.db.runTransaction(async tx => {
      if ((await tx.get(ref)).exists) throw new Error('DEPLOYMENT_IN_PROGRESS');
      tx.create(ref, { ownerToken, releaseId, acquiredAt: new Date().toISOString() });
    });
  }
  async requireDeploymentLease(projectId: string, ownerToken: string | undefined, releaseId: string): Promise<void> {
    const lease = (await this.db.collection('deploymentLeases').doc(projectId).get()).data();
    if (!ownerToken || lease?.ownerToken !== ownerToken || lease?.releaseId !== releaseId) throw new Error('DEPLOYMENT_LEASE_REQUIRED');
  }
  async releaseDeploymentLease(projectId: string, ownerToken: string): Promise<void> {
    const ref = this.db.collection('deploymentLeases').doc(projectId);
    await this.db.runTransaction(async tx => {
      if ((await tx.get(ref)).data()?.ownerToken !== ownerToken) throw new Error('DEPLOYMENT_LEASE_REQUIRED');
      tx.delete(ref);
    });
  }
  async get(releaseId: string): Promise<ApprovedRelease | undefined> {
    return (await this.db.collection('approvedReleases').doc(releaseId).get()).data()?.release as ApprovedRelease | undefined;
  }
  async approve(release: ApprovedRelease, evidence: unknown): Promise<void> {
    const ref = this.db.collection('approvedReleases').doc(release.releaseId);
    await this.db.runTransaction(async tx => {
      const old = (await tx.get(ref)).data();
      if (old) {
        if (!isDeepStrictEqual(old.release, release)) throw new Error('RELEASE_APPROVAL_CONFLICT');
        return;
      }
      tx.create(ref, { release, evidence });
    });
  }
  readonly records: DeploymentRecordRepositoryPort = {
    get: async releaseId => (await this.db.collection('deploymentProvenance').doc(releaseId).get()).data()?.record as PublicDeploymentRecord | undefined,
    record: async input => this.db.runTransaction(async tx => {
      const ref = this.db.collection('deploymentProvenance').doc(input.releaseId);
      const old = (await tx.get(ref)).data();
      if (old) return old.fingerprint === input.fingerprint
        ? { kind: 'replayed', record: old.record as PublicDeploymentRecord }
        : { kind: 'conflict' };
      tx.create(ref, { fingerprint: input.fingerprint, record: input.candidate });
      return { kind: 'recorded', record: input.candidate };
    }),
  };
}

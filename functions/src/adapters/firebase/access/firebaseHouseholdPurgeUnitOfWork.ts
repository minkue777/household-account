import type { Firestore, Transaction, DocumentSnapshot } from 'firebase-admin/firestore';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'node:crypto';
import type { HouseholdPurgeAggregateState, HouseholdPurgeClaim, HouseholdPurgeProcessRecord } from '../../../contexts/access/household-purge-process/domain/model/householdPurgeProcess';
import type { HouseholdPurgeExecutionPort, HouseholdPurgeMutation, HouseholdPurgeUnitOfWorkPort } from '../../../contexts/access/household-purge-process/application/ports/out/householdPurgeProcessPorts';

export const purgeHash = (value: string): string => createHash('sha256').update(value).digest('hex');

function claim(snapshot: DocumentSnapshot): HouseholdPurgeClaim | undefined {
  const data = snapshot.data();
  if (!data) return undefined;
  // 기존 claim에 version이 없어도 문서 변경 전체를 비교합니다. 원문 UID는 snapshot에 보존하지 않습니다.
  const fingerprint = JSON.stringify(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));
  return { claimRef: snapshot.id, principalRef: String(data.principalUid ?? ''), householdId: String(data.householdId ?? ''),
    membershipId: String(data.memberId ?? ''), version: parseInt(purgeHash(fingerprint).slice(0, 13), 16) };
}

/** 한 운영 요청의 Process와 현재 단계의 claim page만 읽습니다. */
export class FirebaseHouseholdPurgeUnitOfWork implements HouseholdPurgeUnitOfWorkPort, HouseholdPurgeExecutionPort {
  private leaseToken?: string;
  constructor(private readonly db: Firestore, private readonly householdId: string,
    private readonly processId: string, private readonly operatorRef: string) {}

  private process() { return this.db.collection('householdPurgeProcesses').doc(this.processId); }

  private async load(tx: Transaction): Promise<HouseholdPurgeAggregateState> {
    const household = await tx.get(this.db.collection('households').doc(this.householdId));
    const document = await tx.get(this.process());
    if (!household.exists) throw new Error('HOUSEHOLD_NOT_FOUND');
    const data = document.data();
    if (this.leaseToken && data?.leaseToken !== this.leaseToken) throw new Error('PURGE_LEASE_LOST');
    let process = data?.process as HouseholdPurgeProcessRecord | undefined;
    if (process && data?.snapshotStorage === 'paged-v1') {
      const offset = process.claimFinalizationCheckpoint === 'finalization:start' ? 0 : Number(process.claimFinalizationCheckpoint.split(':')[1]);
      const page = process.phase === 'claim-finalization'
        ? (await tx.get(this.process().collection('claimSnapshots').orderBy('index').startAt(offset).limit(process.claimPageSize))).docs.map(item => {
          const { index: _index, ...entry } = item.data();
          return entry as HouseholdPurgeProcessRecord['claimSnapshotEntries'][number];
        }) : [];
      process = { ...process, claimSnapshotEntries: page, claimSnapshotPageOffset: process.phase === 'claim-finalization' ? offset : process.claimSnapshotEntryCount ?? 0, claimConflicts: [] };
    }
    const claims: HouseholdPurgeClaim[] = [];
    if (process?.phase === 'claim-snapshot') {
      let query = this.db.collection('principalMembershipClaims').where('householdId', '==', this.householdId)
        .orderBy(FieldPath.documentId()).limit(process.claimPageSize + 1);
      if (process.claimSnapshotCheckpoint.startsWith('snapshot:') && process.claimSnapshotCheckpoint !== 'snapshot:start') {
        query = query.startAfter(process.claimSnapshotCheckpoint.slice('snapshot:'.length));
      }
      for (const item of (await tx.get(query)).docs) { const parsed = claim(item); if (parsed) claims.push(parsed); }
    } else if (process?.phase === 'claim-finalization') {
      const offset = process.claimFinalizationCheckpoint === 'finalization:start' ? 0 : Number(process.claimFinalizationCheckpoint.split(':')[1]);
      const relativeOffset = offset - (process.claimSnapshotPageOffset ?? 0);
      for (const entry of process.claimSnapshotEntries.slice(relativeOffset, relativeOffset + process.claimPageSize)) {
        const parsed = claim(await tx.get(this.db.collection('principalMembershipClaims').doc(entry.claimRef)));
        if (parsed) claims.push(parsed);
      }
    }
    return {
      household: { householdId: this.householdId, lifecycleState: household.data()!.lifecycleState, aggregateVersion: household.data()!.aggregateVersion ?? 1 },
      currentClaims: claims, processes: process ? { [this.processId]: process } : {},
      requestReceipts: data?.requestReceipts ?? {}, events: [],
    };
  }

  read() { return this.db.runTransaction(tx => this.load(tx)); }

  transact<T>(operation: (state: HouseholdPurgeAggregateState) => HouseholdPurgeMutation<T>): Promise<T> {
    return this.db.runTransaction(async tx => {
      const before = await this.load(tx);
      const next = operation(before);
      if (next.state === before) return next.value;
      const process = next.state.processes[this.processId];
      if (process) {
        const previous = before.processes[this.processId];
        const pageOffset = process.claimSnapshotPageOffset ?? 0;
        if (!previous || previous.phase === 'claim-snapshot' || previous.claimSnapshotPageOffset === undefined) {
          process.claimSnapshotEntries.forEach((entry, index) => tx.set(this.process().collection('claimSnapshots').doc(String(pageOffset + index).padStart(12, '0')), { ...entry, index: pageOffset + index }));
        }
        for (const conflict of process.claimConflicts) tx.set(this.process().collection('claimConflicts').doc(purgeHash(conflict.claimRef)), conflict);
        tx.set(this.process(), {
          householdId: this.householdId,
          process: { ...process, claimSnapshotEntries: [], claimConflicts: [], claimSnapshotPageOffset: 0,
            claimSnapshotEntryCount: process.claimSnapshotEntryCount ?? process.claimSnapshotEntries.length,
            claimConflictCount: process.claimConflictCount ?? process.claimConflicts.length },
          snapshotStorage: 'paged-v1', requestReceipts: next.state.requestReceipts,
          operatorRef: this.operatorRef, updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      for (const old of before.currentClaims) {
        if (!next.state.currentClaims.some(item => item.claimRef === old.claimRef)) {
          tx.delete(this.db.collection('principalMembershipClaims').doc(old.claimRef));
        }
      }
      if (before.household.lifecycleState !== next.state.household.lifecycleState) {
        const household = this.db.collection('households').doc(this.householdId);
        if (next.state.household.lifecycleState === 'purged') {
          // 영구 삭제 완료 뒤 표시 이름·legacy key·embedded Member 원문을 남기지 않습니다.
          tx.set(household, { lifecycleState: 'purged', aggregateVersion: next.state.household.aggregateVersion, purgedAt: FieldValue.serverTimestamp() });
        } else tx.update(household, { lifecycleState: next.state.household.lifecycleState, aggregateVersion: next.state.household.aggregateVersion });
      }
      for (const event of next.state.events) {
        const ref = this.process().collection('auditEvents').doc(purgeHash(event.eventType));
        tx.create(ref, { ...event, operatorRef: this.operatorRef, recordedAt: FieldValue.serverTimestamp() });
        tx.create(this.db.collection('outboxEvents').doc(purgeHash(`${this.processId}:${event.eventType}`)), {
          eventId: purgeHash(`${this.processId}:${event.eventType}`), eventType: event.eventType.replace('.v1', ''), eventVersion: 1,
          producerContext: 'access.household-purge-process',
          ...(event.eventType === 'HouseholdPurged.v1' ? { householdIdHash: event.householdIdHash } : { householdId: this.householdId }),
          aggregateId: this.processId, aggregateVersion: next.state.household.aggregateVersion,
          occurredAt: new Date().toISOString(), correlationId: this.processId, causationId: this.processId,
          payload: event, status: 'pending', schemaVersion: 1, createdAt: FieldValue.serverTimestamp(),
        });
      }
      return next.value;
    });
  }

  async runExclusive<T>(_processId: string, operation: () => Promise<T>): Promise<T> {
    const token = randomUUID();
    await this.db.runTransaction(async tx => {
      const current = (await tx.get(this.process())).data();
      if (!current?.process) throw new Error('PURGE_PROCESS_NOT_FOUND');
      // 자동 탈취하지 않습니다. 중단된 실행은 운영자가 별도 확인 후 lease를 해제합니다.
      if (current.leaseToken) throw new Error('PURGE_ALREADY_RUNNING');
      tx.update(this.process(), { leaseToken: token, leaseStartedAt: FieldValue.serverTimestamp() });
    });
    this.leaseToken = token;
    try { return await operation(); }
    finally {
      await this.db.runTransaction(async tx => {
        const current = (await tx.get(this.process())).data();
        if (current?.leaseToken === token) tx.update(this.process(), { leaseToken: FieldValue.delete(), leaseStartedAt: FieldValue.delete() });
      });
      this.leaseToken = undefined;
    }
  }
}

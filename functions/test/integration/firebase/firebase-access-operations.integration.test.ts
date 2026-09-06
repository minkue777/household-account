import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFirebaseHouseholdPurgeRuntime } from '../../../src/bootstrap/operations/householdPurgeRuntime';
import { repairFirebaseLegacyMembership, reconcileFirebaseHouseholdClaimLifecycle } from '../../../src/bootstrap/operations/accessRecoveryRuntime';
import { principalClaimId } from '../../../src/adapters/firebase/access/firebasePrincipalMembershipClaim';

const projectId = 'demo-access-operations';
let app: App;
let db: Firestore;
const suite = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
suite('[HH-002][ADM-003] 실제 Firestore 운영 교정과 단계별 영구 삭제', () => {
  beforeAll(() => { app = initializeApp({ projectId }, projectId); db = getFirestore(app); });
  beforeEach(async () => { await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' }); });
  afterAll(async () => { if (app) await deleteApp(app); });
  const admin = { principalRef: 'operator', capabilities: ['household.purge.permanent'] as const };
  const runner = { systemRef: 'test-runner', capabilities: ['householdLifecycle:purge'] as const };
  const runtime = () => createFirebaseHouseholdPurgeRuntime(db, { householdId: 'h1', idempotencyKey: 'request', operatorRef: 'operator', pageSize: 1 });

  it('일반 권한·active 가구는 시작할 수 없고 요청 재생은 추가 Event를 만들지 않는다', async () => {
    await db.doc('households/h1').set({ lifecycleState: 'active', aggregateVersion: 1 });
    const command = { householdId: 'h1', idempotencyKey: 'request', expectedVersion: 1, confirmation: '별도 영구 삭제 요청' };
    expect(await runtime().application.requestPermanentHouseholdPurge({ principalRef: 'member', capabilities: [] }, command)).toMatchObject({ kind: 'forbidden' });
    expect(await runtime().application.requestPermanentHouseholdPurge(admin, command)).toMatchObject({ kind: 'conflict', code: 'HOUSEHOLD_MUST_BE_DELETED' });
    await db.doc('households/h1').update({ lifecycleState: 'deleted' });
    const first = await runtime().application.requestPermanentHouseholdPurge(admin, command);
    expect(first.kind).toBe('accepted');
    expect(await runtime().application.requestPermanentHouseholdPurge(admin, command)).toEqual(first);
    expect((await db.collection('outboxEvents').get()).size).toBe(1);
  });

  it('재시작 후 page부터 재개하고 모든 Context 완료 전 claim 보존, 변경된 claim과 다른 가구·전역 device는 보존한다', async () => {
    await db.doc('households/h1').set({ name: '삭제할 이름', lifecycleState: 'deleted', aggregateVersion: 2 });
    await db.doc('households/h1/members/m1').set({ displayName: '사용자', linkedPrincipalUid: 'u1' });
    for (let i = 1; i <= 3; i += 1) await db.doc(`principalMembershipClaims/c${i}`).set({ principalUid: `u${i}`, householdId: 'h1', memberId: `m${i}`, householdLifecycleState: 'deleted' });
    await db.doc('expenses/e1').set({ householdId: 'h1', amount: 100 });
    await db.doc('expenses/e2').set({ householdId: 'h2', amount: 200 });
    await db.doc('households/h1/assets/a1').set({ name: '자산' });
    await db.doc('households/h1/assets/a1/positions/p1').set({ quantity: 1 });
    await db.doc('households/h1/assets/missing/positions/orphan').set({ quantity: 2 });
    await db.doc('households/h1/assets/a1/positions/missing/receipts/orphan').set({ amount: 9 });
    await db.doc('shortcutHttpReceipts/legacy').set({ result: { kind: 'success', transaction: { kind: 'created', transactionId: 'e1' } } });
    await db.doc('shortcutHttpReceipts/other').set({ householdId: 'h2', result: { kind: 'success', transaction: { transactionId: 'e2' } } });
    await db.doc('notification_debug_logs/raw').set({ householdId: 'h1', fullText: '삭제해야 하는 결제 원문' });
    await db.doc('notificationDevices/device-1').set({ fid: 'global-device' });
    const initial = runtime();
    await initial.application.requestPermanentHouseholdPurge(admin, { householdId: 'h1', idempotencyKey: 'request', expectedVersion: 2, confirmation: '사용자가 별도로 승인함' });
    let changed = false;
    let completed = false;
    for (let step = 0; step < 100; step += 1) {
      const next = runtime();
      const process = (await db.doc(`householdPurgeProcesses/${next.processId}`).get()).data()!.process;
      if (process.phase !== 'claim-finalization' && process.phase !== 'completed') expect((await db.collection('principalMembershipClaims').get()).size).toBe(3);
      if (process.phase === 'claim-finalization' && !changed) {
        await db.doc('principalMembershipClaims/c3').update({ householdId: 'h2' });
        changed = true;
      }
      const result = await next.application.runHouseholdPurgeProcess(runner, next.processId);
      expect(['progressed', 'completed']).toContain(result.kind);
      if (result.kind === 'completed') { completed = true; break; }
    }
    expect(completed).toBe(true);
    expect((await db.doc('households/h1').get()).data()).toMatchObject({ lifecycleState: 'purged' });
    expect((await db.doc('households/h1').get()).data()).not.toHaveProperty('name');
    expect((await db.doc('expenses/e1').get()).exists).toBe(false);
    expect((await db.doc('expenses/e2').get()).exists).toBe(true);
    expect((await db.doc('households/h1/assets/a1/positions/p1').get()).exists).toBe(false);
    expect((await db.doc('households/h1/assets/missing/positions/orphan').get()).exists).toBe(false);
    expect((await db.doc('households/h1/assets/a1/positions/missing/receipts/orphan').get()).exists).toBe(false);
    expect((await db.doc('shortcutHttpReceipts/legacy').get()).exists).toBe(false);
    expect((await db.doc('shortcutHttpReceipts/other').get()).exists).toBe(true);
    expect((await db.doc('notification_debug_logs/raw').get()).exists).toBe(false);
    expect((await db.doc('notificationDevices/device-1').get()).exists).toBe(true);
    expect((await db.collection('principalMembershipClaims').get()).docs.map(doc => doc.id)).toEqual(['c3']);
    expect(await runtime().application.runHouseholdPurgeProcess(runner, initial.processId)).toMatchObject({ kind: 'already-completed' });
    const process = (await db.doc(`householdPurgeProcesses/${initial.processId}`).get()).data()!.process;
    expect(process).toMatchObject({ claimSnapshotEntries: [], claimSnapshotEntryCount: 3, claimConflicts: [], claimConflictCount: 1 });
    expect((await db.collection(`householdPurgeProcesses/${initial.processId}/claimConflicts`).get()).size).toBe(1);
  }, 30_000);

  it('수동 연결 교정은 같은 키에 원자 감사 1건이고 삭제 claim 상태 교정은 binding을 바꾸지 않는다', async () => {
    await db.doc('households/h1').set({ name: '기존 가구', lifecycleState: 'active', aggregateVersion: 1, members: [{ id: 'm1', name: '사용자' }] });
    const input = { householdId: 'h1', principalUid: 'u1', memberId: 'm1', operatorRef: 'operator', reason: '연결 교정 승인', idempotencyKey: 'repair-1' };
    expect(await repairFirebaseLegacyMembership(db, input)).toMatchObject({ kind: 'repaired' });
    expect(await repairFirebaseLegacyMembership(db, input)).toMatchObject({ kind: 'repaired' });
    expect((await db.collection('accessRecoveryAudit').get()).size).toBe(1);
    await db.doc('households/h1').update({ lifecycleState: 'deleted' });
    expect(await reconcileFirebaseHouseholdClaimLifecycle(db, input)).toEqual({ changedCount: 1, nextCursor: null });
    expect((await db.doc(`principalMembershipClaims/${principalClaimId('u1')}`).get()).data()).toMatchObject({ householdId: 'h1', memberId: 'm1', householdLifecycleState: 'deleted' });
    await db.doc('households/h1').update({ lifecycleState: 'purging' });
    const claimBefore = (await db.doc(`principalMembershipClaims/${principalClaimId('u1')}`).get()).data();
    await expect(reconcileFirebaseHouseholdClaimLifecycle(db, input)).rejects.toThrow('HOUSEHOLD_PURGE_BARRIER');
    expect((await db.doc(`principalMembershipClaims/${principalClaimId('u1')}`).get()).data()).toEqual(claimBefore);
  });

  it('claim snapshot은 현재 페이지만 process 밖에 저장하며 프로세스 본문 크기가 누적되지 않는다', async () => {
    await db.doc('households/h1').set({ lifecycleState: 'deleted', aggregateVersion: 1 });
    for (let batchIndex = 0; batchIndex < 2; batchIndex += 1) {
      const batch = db.batch();
      for (let index = batchIndex * 350; index < (batchIndex + 1) * 350; index += 1) batch.set(db.doc(`principalMembershipClaims/c${String(index).padStart(6, '0')}`), { householdId: 'h1', memberId: `member-${index}-${'x'.repeat(1450)}` });
      await batch.commit();
    }
    const create = () => createFirebaseHouseholdPurgeRuntime(db, { householdId: 'h1', idempotencyKey: 'large', operatorRef: 'operator', pageSize: 100 });
    const started = create();
    await started.application.requestPermanentHouseholdPurge(admin, { householdId: 'h1', idempotencyKey: 'large', expectedVersion: 1, confirmation: '승인' });
    for (let page = 0; page < 7; page += 1) await create().application.runHouseholdPurgeProcess(runner, started.processId);
    const stored = (await db.doc(`householdPurgeProcesses/${started.processId}`).get()).data()!;
    expect(stored.process).toMatchObject({ claimSnapshotEntries: [], claimSnapshotEntryCount: 700, phase: 'context-purge' });
    expect(Buffer.byteLength(JSON.stringify(stored))).toBeLessThan(15_000);
    expect((await db.collection(`householdPurgeProcesses/${started.processId}/claimSnapshots`).count().get()).data().count).toBe(700);
  }, 30_000);

  it('소유를 확인할 수 없는 legacy receipt가 있으면 금융 자료를 지우기 전에 영구 실패로 남긴다', async () => {
    await db.doc('households/h1').set({ lifecycleState: 'deleted', aggregateVersion: 1 });
    await db.doc('expenses/e1').set({ householdId: 'h1', amount: 100 });
    await db.doc('shortcutHttpReceipts/unknown').set({ result: { kind: 'success', transaction: { kind: 'created', transactionId: 'missing' } } });
    const current = runtime();
    await current.application.requestPermanentHouseholdPurge(admin, { householdId: 'h1', idempotencyKey: 'request', expectedVersion: 1, confirmation: '승인' });
    await current.application.runHouseholdPurgeProcess(runner, current.processId);
    const result = await runtime().application.runHouseholdPurgeProcess(runner, current.processId);
    expect(result).toMatchObject({ kind: 'operational-conflict', code: 'PARTICIPANT_PERMANENT_FAILURE' });
    expect((await db.doc(`householdPurgeProcesses/${current.processId}`).get()).data()!.process.participants['household-finance'].lastFailureCode).toBe('SHORTCUT_RECEIPT_OWNERSHIP_UNRESOLVED');
    expect((await db.doc('expenses/e1').get()).exists).toBe(true);
    expect((await db.doc('shortcutHttpReceipts/unknown').get()).exists).toBe(true);
  });
});

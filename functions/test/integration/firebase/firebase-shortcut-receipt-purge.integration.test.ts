import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { withShortcutReceiptOwnershipPreflight } from '../../../src/adapters/firebase/payment-capture/firebaseShortcutReceiptPurgePreflight';

const projectId = 'demo-shortcut-receipt-purge';
const suite = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const input = { householdId: 'h1', processId: 'purge-1', participant: 'household-finance' as const, checkpoint: 'household-finance:start' };
let app: App;
let db: Firestore;
const receipt = (transaction: Record<string, unknown>) => ({ result: { kind: 'success', transaction } });

suite('구형 Shortcut HTTP receipt의 canonical 소유가구 판정', () => {
  beforeAll(() => { app = initializeApp({ projectId }, projectId); db = getFirestore(app); });
  beforeEach(async () => {
    const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
    if (!response.ok) throw new Error('EMULATOR_RESET_FAILED');
    await db.doc('households/h1').set({ householdId: 'h1', lifecycleState: 'deleted' });
    await db.doc('households/h2').set({ householdId: 'h2', lifecycleState: 'active' });
  });
  afterAll(async () => { if (app) await deleteApp(app); });
  const next = () => ({ purgeHouseholdData: vi.fn(async () => ({ kind: 'purge-completed' as const, finalCheckpoint: 'done', deletedCount: 0 })) });

  it('flat 원본 없이 삭제·분리된 canonical 거래로 단일/기존/복수 ID를 판정하고 page 재개와 다른 가구 보존을 지킵니다', async () => {
    await db.doc('households/h1/ledgerTransactions/e1').set({ transactionId: 'e1', householdId: 'h1', lifecycleState: 'deleted' });
    // Earlier canonical documents contain their ID only in the document path.
    await db.doc('households/h1/ledgerTransactions/e2').set({ householdId: 'h1', lifecycleState: 'superseded' });
    await db.doc('households/h2/ledgerTransactions/other').set({ transactionId: 'other', householdId: 'h2' });
    await db.doc('shortcutHttpReceipts/a').set(receipt({ transactionId: 'e1' }));
    await db.doc('shortcutHttpReceipts/b').set(receipt({ existingTransactionId: 'e2' }));
    await db.doc('shortcutHttpReceipts/c').set(receipt({ transactionIds: ['e1', 'e2', 'e1'] }));
    await db.doc('shortcutHttpReceipts/d').set(receipt({ transactionId: 'other' }));
    await db.doc('shortcutHttpReceipts/e').set({ result: { kind: 'rejected' }, fingerprintHash: 'hash-only' });
    await db.doc('shortcutHttpReceipts/f').set({ householdId: 'h2', ...receipt({ transactionId: 'no-longer-present' }) });
    const following = next();
    const preflight = withShortcutReceiptOwnershipPreflight(db, following, 2);
    const first = await preflight.purgeHouseholdData(input);
    expect(first).toEqual({ kind: 'page-processed', nextCheckpoint: 'household-finance:receipt-ownership:b', deletedCount: 0 });
    const second = await preflight.purgeHouseholdData({ ...input, checkpoint: 'household-finance:receipt-ownership:b' });
    expect(second).toEqual({ kind: 'page-processed', nextCheckpoint: 'household-finance:receipt-ownership:d', deletedCount: 0 });
    expect(await preflight.purgeHouseholdData({ ...input, checkpoint: 'household-finance:receipt-ownership:d' }))
      .toEqual({ kind: 'page-processed', nextCheckpoint: 'household-finance:0', deletedCount: 0 });
    expect((await db.collection('expenses').get()).empty).toBe(true);
    for (const id of ['a', 'b', 'c']) expect((await db.doc(`shortcutHttpReceipts/${id}`).get()).get('householdId')).toBe('h1');
    for (const id of ['d', 'e']) expect((await db.doc(`shortcutHttpReceipts/${id}`).get()).data()).not.toHaveProperty('householdId');
    expect((await db.doc('shortcutHttpReceipts/f').get()).get('householdId')).toBe('h2');
    expect(following.purgeHouseholdData).not.toHaveBeenCalled();
    const after = { ...input, checkpoint: 'household-finance:0' };
    expect(await preflight.purgeHouseholdData(after)).toEqual({ kind: 'purge-completed', finalCheckpoint: 'done', deletedCount: 0 });
    expect(following.purgeHouseholdData).toHaveBeenCalledWith(after);
  });

  it.each(['duplicate-tenant', 'mixed-ids', 'body-tenant', 'wrong-document-id', 'missing-canonical'])('%s이면 소유를 추측하거나 일부 receipt만 갱신하지 않습니다', async scenario => {
    await db.doc('households/h1/ledgerTransactions/good').set({ transactionId: 'good', householdId: 'h1' });
    await db.doc('shortcutHttpReceipts/a-good').set(receipt({ transactionId: 'good' }));
    let result = { transactionId: 'e1' } as Record<string, unknown>;
    if (scenario === 'duplicate-tenant') {
      await db.doc('households/h1/ledgerTransactions/e1').set({ transactionId: 'e1', householdId: 'h1' });
      await db.doc('households/h2/ledgerTransactions/e1').set({ transactionId: 'e1', householdId: 'h2' });
    } else if (scenario === 'mixed-ids') {
      await db.doc('households/h2/ledgerTransactions/e1').set({ transactionId: 'e1', householdId: 'h2' });
      result = { transactionIds: ['good', 'e1'] };
    } else if (scenario === 'body-tenant') {
      await db.doc('households/h1/ledgerTransactions/e1').set({ transactionId: 'e1', householdId: 'h2' });
    } else if (scenario === 'wrong-document-id') {
      await db.doc('households/h1/ledgerTransactions/e1').set({ transactionId: 'incorrect', householdId: 'h1' });
    } else {
      await db.doc('expenses/e1').set({ householdId: 'h1' });
    }
    await db.doc('shortcutHttpReceipts/z-unresolved').set(receipt(result));
    const following = next();
    expect(await withShortcutReceiptOwnershipPreflight(db, following, 10).purgeHouseholdData(input)).toEqual({
      kind: 'permanent-failure', failedCheckpoint: input.checkpoint, errorCode: 'SHORTCUT_RECEIPT_OWNERSHIP_UNRESOLVED',
    });
    expect((await db.doc('shortcutHttpReceipts/a-good').get()).data()).not.toHaveProperty('householdId');
    expect((await db.doc('shortcutHttpReceipts/z-unresolved').get()).data()).not.toHaveProperty('householdId');
    expect(following.purgeHouseholdData).not.toHaveBeenCalled();
  });

  it('성공 기록에 거래 ID가 없으면 원래의 영구 실패를 유지합니다', async () => {
    await db.doc('shortcutHttpReceipts/missing-result').set(receipt({ kind: 'created' }));
    expect(await withShortcutReceiptOwnershipPreflight(db, next(), 10).purgeHouseholdData(input)).toMatchObject({
      kind: 'permanent-failure', errorCode: 'SHORTCUT_RECEIPT_OWNERSHIP_UNRESOLVED',
    });
  });
});

import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCategoryCatalogDocument } from '../../../src/adapters/firebase/categories/categoryCatalogDocument';
// @ts-expect-error The operational ESM tool is exercised against actual Firestore.
import { applyCleanup, planCleanup } from '../../../scripts/cleanup-consolidated-storage.mjs';
// @ts-expect-error Use the same typed backup serialization as the production tool.
import { applyPlan, inspect, encode, decode } from '../../../scripts/consolidate-storage.mjs';

const project = 'demo-household-storage-cleanup';
const suite = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let app: App;
let db: Firestore;
async function seed() {
  await db.doc('households/h').set({ defaultCategoryKey: 'h-food' });
  await db.doc('households/h/members/m').set({ memberId: 'm' });
  await db.doc('categories/h-food').set({ householdId: 'h', key: 'food', name: '식비', color: '#123456', budget: 0, order: 0 });
  await db.doc('households/h/categories/food').set({ householdId: 'h', categoryId: 'food', name: '식비', color: '#123456', budgetInWon: 0, state: 'active', sortOrder: 0, version: 2 });
  await db.doc('households/h/categorySettings/default').set({ defaultCategoryId: 'food', catalogVersion: 3 });
  const ledger = { householdId: 'h', merchant: '가맹점', memo: '원문', categoryId: 'food', accountingDate: '2026-09-18', localTime: '12:00', amountInWon: 1000,
    lifecycleState: 'active', creatorMemberId: 'm', transactionType: 'expense', aggregateVersion: 2, source: 'manual', settledAt: new Timestamp(1000, 123456789) };
  await db.doc('households/h/ledgerTransactions/a').set(ledger);
  await db.doc('expenses/a').set(ledger);
  await db.doc('households/h/ledgerTransactions/audit-only').set({ ...ledger, lifecycleState: 'superseded' });
  await db.doc('shortcutHttpReceipts/receipt').set({ householdId: 'h', status: 'succeeded' });
  await db.doc('dividend_snapshots/dividend').set({ householdId: 'h', events: { event: 10 } });
  await db.doc('recurring_expenses/plan').set({ householdId: 'h' });
  await db.doc('households/h/outbox/event').set({ eventType: 'LedgerChanged.v1' });
  const migration = await inspect(db, readCategoryCatalogDocument);
  expect(migration.issues).toEqual([]);
  await applyPlan(db, migration);
}

async function seedPositionWithCanonicalOnlyParent() {
  const common = { householdId: 'h', schemaVersion: 1, aggregateVersion: 1, lifecycleState: 'active',
    createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-18T00:00:00.000Z' };
  await db.doc('households/h/assets/investment').set({ ...common, assetId: 'investment', name: '계좌', type: 'stock',
    ownerRef: { kind: 'household' }, currency: 'KRW', currentBalance: 1000, memo: '', order: 0, automation: {} });
  const position = { ...common, positionId: 'p', assetId: 'investment', positionKind: 'stock', instrumentCode: '005930',
    instrumentName: '주식', instrumentType: 'stock', market: 'KRX', currency: 'KRW', priceScale: 1, quantity: 1, averagePriceInWon: 1000,
    instrument: { market: 'KRX', instrumentType: 'STOCK', code: '005930', name: '주식', currency: 'KRW', priceScale: 1 } };
  await db.doc('stock_holdings/p').set(position);
  await db.doc('households/h/assets/investment/positions/p').set(position);
}

suite('이관한 기존 원본의 한정 삭제', () => {
  beforeAll(() => { app = initializeApp({ projectId: project }, project); db = getFirestore(app); });
  beforeEach(async () => {
    const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
    if (!response.ok) throw new Error('EMULATOR_RESET_FAILED');
    await seed();
  });
  afterAll(async () => { if (app) await deleteApp(app); });

  it('전체 원본을 정밀도 손실 없이 백업하고 canonical·감사이력·별도 업무 자료를 보존한다', async () => {
    const original = await db.doc('expenses/a').get();
    const plan = decode(JSON.parse(JSON.stringify(encode(await planCleanup(db, readCategoryCatalogDocument)))));
    const source = plan.deletions.find((item: { path: string }) => item.path === 'expenses/a');
    expect(source.data.settledAt.isEqual(original.get('settledAt'))).toBe(true);
    expect(source.data.memo).toBe('원문');
    expect(plan.deletions.map((item: { path: string }) => item.path).sort()).toEqual([
      'categories/h-food', 'expenses/a', 'households/h/categories/food', 'households/h/categorySettings/default',
    ]);
    const target = await db.doc('households/h/ledgerTransactions/a').get();
    expect(await applyCleanup(db, plan)).toEqual({ deleted: 4, alreadyDeleted: 0, verifiedTargets: 2 });
    expect((await db.doc('households/h/ledgerTransactions/a').get()).updateTime!.isEqual(target.updateTime!)).toBe(true);
    for (const path of ['households/h/ledgerTransactions/audit-only', 'households/h/categoryCatalog/current', 'shortcutHttpReceipts/receipt',
      'dividend_snapshots/dividend', 'recurring_expenses/plan', 'households/h/outbox/event']) {
      expect((await db.doc(path).get()).exists).toBe(true);
    }
    expect(await applyCleanup(db, plan)).toEqual({ deleted: 0, alreadyDeleted: 4, verifiedTargets: 2 });
    expect((await planCleanup(db, readCategoryCatalogDocument)).deletions).toEqual([]);
  });

  it.each(['expenses/a', 'households/h/ledgerTransactions/a'])('검토 후 %s가 변경되면 아무 원본도 지우지 않는다', async path => {
    const plan = await planCleanup(db, readCategoryCatalogDocument);
    await db.doc(path).update({ memo: '동시 변경' });
    await expect(applyCleanup(db, plan)).rejects.toThrow('CLEANUP_SOURCE_OR_TARGET_DRIFT');
    for (const item of plan.deletions) expect((await db.doc(item.path).get()).exists).toBe(true);
  });

  it('동일 계획의 일부 삭제 후 재개할 수 있고 승인되지 않은 새 문서는 삭제하지 않는다', async () => {
    const plan = await planCleanup(db, readCategoryCatalogDocument);
    await applyCleanup(db, { ...plan, deletions: plan.deletions.slice(0, 1) });
    await db.doc('expenses/new-source').set({ householdId: 'h', amount: 1 });
    expect(await applyCleanup(db, plan)).toEqual({ deleted: 3, alreadyDeleted: 1, verifiedTargets: 2 });
    expect((await db.doc('expenses/new-source').get()).exists).toBe(true);
  });

  it('보존 대상 경로로 변조한 계획과 canonical 누락/미이관 값은 차단한다', async () => {
    const plan = await planCleanup(db, readCategoryCatalogDocument);
    await expect(applyCleanup(db, { ...plan, deletions: [{ ...plan.deletions[0], path: 'households/h/ledgerTransactions/a' }] }))
      .rejects.toThrow('DELETE_PATH_NOT_ALLOWED');
    await db.doc('households/h/ledgerTransactions/a').delete();
    await expect(planCleanup(db, readCategoryCatalogDocument)).rejects.toThrow('CANONICAL_TARGET_MISSING');
    expect((await db.doc('expenses/a').get()).exists).toBe(true);
  });

  it('가구 소속을 확정하지 못한 전역 원본을 누락한 채 삭제 계획을 만들지 않는다', async () => {
    await db.doc('expenses/orphan').set({ householdId: 'missing' });
    await expect(planCleanup(db, readCategoryCatalogDocument)).rejects.toThrow('ORPHANED_HOUSEHOLD_SOURCE');
    expect((await db.doc('expenses/a').get()).exists).toBe(true);
  });

  it('Timestamp 백업 표식과 같은 일반 map을 원래 타입으로 복구할 수 없으면 삭제 계획을 거부한다', async () => {
    await db.doc('expenses/a').update({ historicalPayload: { $timestamp: [1000, 123456789] } });
    await expect(planCleanup(db, readCategoryCatalogDocument)).rejects.toThrow('BACKUP_NOT_LOSSLESS');
    expect((await db.doc('expenses/a').get()).get('historicalPayload')).toEqual({ $timestamp: [1000, 123456789] });
    expect((await db.doc('categories/h-food').get()).exists).toBe(true);
    expect((await db.doc('households/h/ledgerTransactions/a').get()).exists).toBe(true);
  });

  it.each(['before-apply', 'before-transaction'] as const)('flat 자산이 없는 Position의 canonical 부모가 %s에 사라지면 원본 삭제를 차단한다', async moment => {
    await seedPositionWithCanonicalOnlyParent();
    const plan = await planCleanup(db, readCategoryCatalogDocument);
    expect(plan.guards.map((item: { path: string }) => item.path)).toContain('households/h/assets/investment');
    const parent = db.doc('households/h/assets/investment');
    if (moment === 'before-apply') await parent.delete();
    else {
      const run = db.runTransaction.bind(db);
      vi.spyOn(db, 'runTransaction').mockImplementationOnce(async (...args) => {
        await parent.delete();
        return run(...args);
      });
    }
    await expect(applyCleanup(db, plan)).rejects.toThrow(moment === 'before-apply'
      ? 'CLEANUP_SOURCE_OR_TARGET_DRIFT' : 'CLEANUP_TARGET_DRIFT');
    for (const item of plan.deletions) expect((await db.doc(item.path).get()).exists).toBe(true);
    expect((await db.doc('households/h/assets/investment/positions/p').get()).exists).toBe(true);
  });
});

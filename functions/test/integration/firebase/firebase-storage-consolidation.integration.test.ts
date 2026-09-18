import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readCategoryCatalogDocument } from '../../../src/adapters/firebase/categories/categoryCatalogDocument';
// @ts-expect-error 운영 ESM 도구를 실제 Firestore에서 실행합니다.
import { applyPlan, inspect, encode, decode } from '../../../scripts/consolidate-storage.mjs';

const project = 'demo-household-storage-consolidation';
const suite = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let app: App;
let db: Firestore;
async function seed() {
  await db.doc('households/h').set({ defaultCategoryKey: 'h-food' });
  await db.doc('households/h/members/member').set({ memberId: 'member', displayName: '멤버' });
  await db.doc('categories/h-food').set({ householdId: 'h', key: 'food', name: '식비', color: '#123456', budget: 0, order: 0 });
  await db.doc('households/h/categories/food').set({ householdId: 'h', categoryId: 'food', name: '식비', color: '#123456', budgetInWon: 0, state: 'active', sortOrder: 0, version: 2 });
  await db.doc('households/h/categorySettings/default').set({ defaultCategoryId: 'food', catalogVersion: 3 });
  const data = { householdId: 'h', merchant: '가맹점', memo: '', categoryId: 'food', accountingDate: '2026-09-18', localTime: '12:00',
    amountInWon: 1000, lifecycleState: 'active', creatorMemberId: 'member', transactionType: 'expense', aggregateVersion: 2, source: 'manual' };
  await db.doc('households/h/ledgerTransactions/a').set(data);
  await db.doc('expenses/a').set({ ...data, settledAt: new Timestamp(1000, 123456789), cardLastFour: '1234' });
}
suite('저장소 통합 운영 이관', () => {
  beforeAll(() => { app = initializeApp({ projectId: project }, project); db = getFirestore(app); });
  beforeEach(async () => {
    const result = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
    if (!result.ok) throw new Error('EMULATOR_RESET_FAILED');
    await seed();
  });
  afterAll(async () => { if (app) await deleteApp(app); });

  it('원본 불변·ID/기본분류/0원예산·Timestamp 정밀도를 보존하고 재실행은 쓰지 않습니다', async () => {
    const source = await db.doc('expenses/a').get();
    const plan = await inspect(db, readCategoryCatalogDocument);
    expect(plan.issues).toEqual([]);
    expect((await db.doc('households/h/categoryCatalog/current').get()).exists).toBe(false);
    const decoded = decode(JSON.parse(JSON.stringify(encode(plan))));
    expect(await applyPlan(db, decoded)).toEqual({ written: 2, alreadyApplied: 0 });
    const category = (await db.doc('households/h/categoryCatalog/current').get()).data();
    expect(category).toMatchObject({ defaultCategoryId: 'food', catalogVersion: 3, categoryAliases: { 'h-food': 'food' },
      categories: [{ categoryId: 'food', budgetInWon: 0, version: 2 }] });
    const result = await db.doc('households/h/ledgerTransactions/a').get();
    expect(result.get('settledAt').isEqual(source.get('settledAt'))).toBe(true);
    expect((await db.doc('expenses/a').get()).updateTime?.isEqual(source.updateTime!)).toBe(true);
    expect(await applyPlan(db, decoded)).toEqual({ written: 0, alreadyApplied: 2 });
    expect((await db.doc('households/h/ledgerTransactions/a').get()).updateTime?.isEqual(result.updateTime!)).toBe(true);
  });

  it.each(['source', 'target'])('%s가 검토 후 변경되면 첫 쓰기 전에 전체 중단합니다', async kind => {
    const plan = await inspect(db, readCategoryCatalogDocument);
    await db.doc(kind === 'source' ? 'expenses/a' : 'households/h/ledgerTransactions/a').update({ memo: '동시 수정' });
    await expect(applyPlan(db, plan)).rejects.toThrow('SOURCE_DRIFT');
    expect((await db.doc('households/h/categoryCatalog/current').get()).exists).toBe(false);
    expect((await db.doc('households/h/ledgerTransactions/a').get()).get('settledAt')).toBeUndefined();
  });

  it('일부 이관 완료 뒤 재개하면 이미 반영된 문서는 건드리지 않습니다', async () => {
    const plan = await inspect(db, readCategoryCatalogDocument);
    await applyPlan(db, { ...plan, plans: plan.plans.slice(0, 1) });
    expect(await applyPlan(db, plan)).toEqual({ written: 1, alreadyApplied: 1 });
  });

  it('업무 값 충돌을 덮어쓰거나 누락된 canonical 거래를 임의 생성하지 않습니다', async () => {
    await db.doc('households/h/ledgerTransactions/a').update({ amountInWon: 999 });
    await db.doc('expenses/unmigrated').set((await db.doc('expenses/a').get()).data()!);
    const plan = await inspect(db, readCategoryCatalogDocument);
    expect(plan.issues.map((issue: { code: string }) => issue.code)).toEqual(expect.arrayContaining([
      'LEDGER_MISMATCH:amountInWon', 'LEDGER_CANONICAL_MISSING:document',
    ]));
    await expect(applyPlan(db, plan)).rejects.toThrow('PLAN_HAS_ISSUES');
    expect((await db.doc('households/h/categoryCatalog/current').get()).exists).toBe(false);
  });
});

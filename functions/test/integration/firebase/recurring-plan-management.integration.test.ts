import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FirebaseRecurringPlanManagementStore } from '../../../src/adapters/firebase/recurring/firebaseRecurringPlanManagementStore';
import { FirebaseTransactionalOutbox } from '../../../src/adapters/firebase/outbox/firebaseTransactionalOutbox';
import { createRecurringPlanManagementApplication } from '../../../src/contexts/household-finance/recurring/application/recurringPlanManagementApplication';
import { categoryCatalogDocument } from '../../support/category-catalog-document';
import { FirebaseRecurringFinanceUnitOfWork } from '../../../src/adapters/firebase/recurring/firebaseRecurringFinanceUnitOfWork';
import { createRecurringSchedulerWorkflowApplication } from '../../../src/contexts/household-finance/recurring/application/recurringSchedulerWorkflowApplication';

const withEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
withEmulator('[REC-001][REC-006][T-REC-003] 정기 계획 실제 단건 transaction', () => {
  const app = initializeApp({ projectId: 'demo-recurring-plan-management' }, 'recurring-plan-management');
  const db = getFirestore(app);
  const now = '2026-10-05T01:00:00.000Z';
  beforeAll(async () => { await db.recursiveDelete(db.collection('households')); await db.recursiveDelete(db.collection('recurring_expenses')); await db.recursiveDelete(db.collection('outboxEvents')); });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => deleteApp(app));
  async function fixture(id: string) {
    const house = db.doc(`households/${id}`);
    await house.collection('categoryCatalog').doc('current').set(categoryCatalogDocument(id, [{ categoryId: 'food', name: '식비', color: '#112233' }]));
    const store = new FirebaseRecurringPlanManagementStore(db, { householdId: id, requestedAt: now });
    const application = createRecurringPlanManagementApplication({ store, clock: { now: () => now, localDate: () => '2026-10-05' }, identities: { planId: command => `${id}-${command}` } });
    const actor = { householdId: id, actingMemberId: 'creator', capabilities: ['recurring.manage', 'recurring.read'] as const };
    const create = { commandId: 'create', actor, operation: { kind: 'create' as const, merchant: '보험료', amountInWon: 1000, categoryId: 'food', dayOfMonth: 10, active: true } };
    const created = await application.manage(create);
    if (created.kind !== 'success') throw new Error('fixture create failed');
    return { house, store, application, actor, create, plan: created.plan, ref: house.collection('recurringPlans').doc(created.plan.planId) };
  }

  function observeReads() {
    const reads: string[] = [];
    const run = db.runTransaction.bind(db);
    vi.spyOn(db, 'runTransaction').mockImplementation(operation => run(transaction => operation(new Proxy(transaction, {
      get(target, key) {
        if (key === 'get') return (reference: any) => { reads.push(reference.path ?? 'query'); return target.get(reference); };
        if (key === 'getAll') return (...references: any[]) => { reads.push(...references.map(ref => ref.path)); return target.getAll(...references); };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }))));
    return reads;
  }

  it('무관한 plan·receipt 400개를 두어도 대상과 category 문서만 읽고 creator·호환 문서·outbox를 함께 저장한다', async () => {
    const f = await fixture('bounded');
    const batch = db.batch();
    for (let i = 0; i < 200; i++) {
      batch.set(f.house.collection('recurringPlans').doc(`unrelated-${i}`), { untouched: i });
      batch.set(f.house.collection('recurringCommandReceipts').doc(`unrelated-${i}`), { untouched: i });
    }
    await batch.commit();
    const reads = observeReads();
    expect(await f.application.manage({ commandId: 'update', actor: { ...f.actor, actingMemberId: 'other' }, operation: {
      kind: 'update', planId: f.plan.planId, expectedVersion: 1, patch: { amountInWon: 2000 },
    } })).toMatchObject({ kind: 'success', plan: { version: 2, creatorMemberId: 'creator', amountInWon: 2000 } });
    expect(reads).toHaveLength(4);
    expect(reads).toContain(f.ref.path);
    expect(reads).toContain(`recurring_expenses/${f.plan.planId}`);
    expect(reads).toContain('households/bounded/categoryCatalog/current');
    expect(reads.filter(path => path.startsWith('households/bounded/recurringCommandReceipts/'))).toHaveLength(1);
    expect(reads.some(path => path.includes('unrelated') || path === 'query')).toBe(false);
    expect((await db.doc(`recurring_expenses/${f.plan.planId}`).get()).data()).toMatchObject({ amount: 2000, creatorMemberId: 'creator', aggregateVersion: 2 });
    expect((await f.house.collection('recurringPlans').doc('unrelated-199').get()).data()).toEqual({ untouched: 199 });
    expect((await f.house.collection('recurringCommandReceipts').get()).size).toBe(202);
  });

  it('동일 명령 동시 전송은 한 번만 저장하며 update/delete 경합은 한 version만 성공한다', async () => {
    const f = await fixture('race');
    const update = { commandId: 'update', actor: f.actor, operation: { kind: 'update' as const, planId: f.plan.planId, expectedVersion: 1, patch: { memo: '변경' } } };
    const duplicate = await Promise.all([f.application.manage(update), f.application.manage(update)]);
    expect(duplicate.map(result => result.kind).sort()).toEqual(['already-processed', 'success']);
    const results = await Promise.all([
      f.application.manage({ ...update, commandId: 'next', operation: { ...update.operation, expectedVersion: 2 } }),
      f.application.manage({ commandId: 'delete', actor: f.actor, operation: { kind: 'delete', planId: f.plan.planId, expectedVersion: 2 } }),
    ]);
    expect(results.filter(result => result.kind === 'success' || result.kind === 'deleted')).toHaveLength(1);
    expect(results.filter(result => result.kind === 'conflict' || result.kind === 'not-found')).toHaveLength(1);
    expect((await f.ref.get()).get('version')).toBe(3);
    expect((await f.house.collection('recurringCommandReceipts').get()).size).toBe(3);
    expect((await db.collection('outboxEvents').where('householdId', '==', 'race').get()).size).toBe(3);
  }, 30_000);

  it('보관된 category는 새 저장을 막지만 기존 receipt replay와 payload 충돌 우선순위를 유지한다', async () => {
    const f = await fixture('category');
    const catalog = f.house.collection('categoryCatalog').doc('current');
    const data = (await catalog.get()).data()!;
    await catalog.update({ defaultCategoryId: null, categories: data.categories.map((item: object) => ({ ...item, state: 'archive-pending' })) });
    expect(await f.application.manage(f.create)).toMatchObject({ kind: 'already-processed' });
    expect(await f.application.manage({ ...f.create, operation: { ...f.create.operation, merchant: '' } })).toMatchObject({ kind: 'conflict', code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await f.application.manage({ commandId: 'update', actor: f.actor, operation: { kind: 'update', planId: f.plan.planId, expectedVersion: 1, patch: { memo: '변경' } } }))
      .toEqual({ kind: 'validation-error', code: 'CATEGORY_NOT_USABLE' });
    expect((await f.ref.get()).get('version')).toBe(1);
    expect((await f.house.collection('recurringCommandReceipts').get()).size).toBe(1);
  });

  it('outbox 저장 실패는 plan·legacy·receipt를 모두 rollback한다', async () => {
    const f = await fixture('rollback');
    const before = (await f.ref.get()).data();
    const legacy = db.doc(`recurring_expenses/${f.plan.planId}`);
    const legacyBefore = (await legacy.get()).data();
    vi.spyOn(FirebaseTransactionalOutbox.prototype, 'append').mockImplementationOnce(() => { throw new Error('outbox failed'); });
    await expect(f.application.manage({ commandId: 'update', actor: f.actor, operation: { kind: 'update', planId: f.plan.planId, expectedVersion: 1, patch: { amountInWon: 3000 } } })).rejects.toThrow('outbox failed');
    expect((await f.ref.get()).data()).toEqual(before);
    expect((await legacy.get()).data()).toEqual(legacyBefore);
    expect((await f.house.collection('recurringCommandReceipts').get()).size).toBe(1);
  });

  it('canonical 우선순위와 creator 없는 legacy를 보존하고 목록 조회는 receipts를 읽지 않는다', async () => {
    const f = await fixture('legacy');
    await db.doc(`recurring_expenses/${f.plan.planId}`).update({ amount: 9999 });
    await db.doc('recurring_expenses/without-creator').set({ householdId: 'legacy', merchant: '미이관', amount: 1000, category: 'food', dayOfMonth: 10, isActive: true });
    expect(await f.application.manage({ commandId: 'missing', actor: f.actor, operation: { kind: 'update', planId: 'without-creator', expectedVersion: 1, patch: { memo: '변경' } } }))
      .toEqual({ kind: 'conflict', code: 'LEGACY_CREATOR_MAPPING_REQUIRED' });
    const reads = observeReads();
    expect(await f.application.list({ actor: f.actor, householdId: 'legacy', limit: 10 })).toMatchObject({ kind: 'success', items: [{ amountInWon: 1000, creatorMemberId: 'creator' }] });
    expect(reads).toEqual(['households/legacy/recurringPlans', 'query']);
    expect((await db.doc('recurring_expenses/without-creator').get()).data()).not.toHaveProperty('creatorMemberId');
  });

  it('[REC-002][REC-003] 실제 1건 페이지와 월별 checkpoint를 이어 실행해 거래·Outbox를 한 번씩 저장한다', async () => {
    const f = await fixture('page');
    const created = await f.application.manage({ ...f.create, commandId: 'create2' });
    expect(created.kind).toBe('success');
    const unitOfWork = new FirebaseRecurringFinanceUnitOfWork(db);
    const firstPage = await unitOfWork.readPlanPage({ afterPlanId: 'page', limit: 1 });
    expect(firstPage.plans.map(plan => plan.planId)).toEqual(['page-create']);
    const secondPage = await unitOfWork.readPlanPage({ afterPlanId: firstPage.nextCursor, limit: 1 });
    expect(secondPage.plans.map(plan => plan.planId)).toEqual(['page-create2']);
    const scheduler = createRecurringSchedulerWorkflowApplication({ unitOfWork,
      clock: { now: () => '2026-12-20T01:00:00Z', localDate: () => '2026-12-20' },
      ids: { transactionId: key => `tx-${key}`, eventId: (key, type) => `${key}-${type}` },
    });
    let checkpoint = `recurring:v2:${encodeURIComponent(JSON.stringify({ asOfDate: '2026-12-20', afterPlanId: 'page' }))}`;
    const firstCheckpoint = checkpoint;
    for (let i = 0; i < 3; i++) {
      const result = await scheduler.processDue({ actor: { kind: 'system', capabilities: ['recurring.process'] },
        asOfDate: '2026-12-20', householdZoneId: 'Asia/Seoul', checkpoint, limit: 2 });
      expect(result).toMatchObject({ kind: 'success', results: [{ kind: 'created' }, { kind: 'created' }] });
      if (result.kind !== 'success' || !result.nextCheckpoint) throw new Error('checkpoint expected');
      checkpoint = result.nextCheckpoint;
    }
    const ledger = await f.house.collection('ledgerTransactions').get();
    expect(ledger.size).toBe(6);
    expect(ledger.docs.map(doc => doc.get('recurringTargetMonth')).sort()).toEqual(['2026-10', '2026-10', '2026-11', '2026-11', '2026-12', '2026-12']);
    expect(ledger.docs.every(doc => doc.get('creatorMemberId') === 'creator')).toBe(true);
    expect((await db.collection('outboxEvents').where('householdId', '==', 'page').get()).size).toBe(14);
    await scheduler.processDue({ actor: { kind: 'system', capabilities: ['recurring.process'] }, asOfDate: '2026-12-20',
      householdZoneId: 'Asia/Seoul', checkpoint: firstCheckpoint, limit: 2 });
    expect((await f.house.collection('ledgerTransactions').get()).size).toBe(6);
    expect((await db.collection('outboxEvents').where('householdId', '==', 'page').get()).size).toBe(14);
  });
});

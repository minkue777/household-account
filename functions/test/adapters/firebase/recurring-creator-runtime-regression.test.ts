import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { createRecurringHouseholdCommandHandlers } from '../../../src/bootstrap/commands/recurringHouseholdCommandHandlers';
import { FirebaseRecurringFinanceUnitOfWork } from '../../../src/adapters/firebase/recurring/firebaseRecurringFinanceUnitOfWork';
import { createRecurringSchedulerWorkflowApplication } from '../../../src/contexts/household-finance/recurring/application/recurringSchedulerWorkflowApplication';
import { InMemoryFirestore } from '../../support/in-memory-firestore';
import { createHash } from 'node:crypto';
import { FirebaseRuntimeMigrationPlanBuilder } from '../../../src/adapters/firebase/migration/firebaseRuntimeMigrationPlanBuilder';
import { RUNTIME_MIGRATION_KIND, RUNTIME_MIGRATION_SCHEMA_SCOPE } from '../../../src/operations/migration/public';

function scheduler(memory: InMemoryFirestore) {
  return createRecurringSchedulerWorkflowApplication({
    unitOfWork: new FirebaseRecurringFinanceUnitOfWork(memory as unknown as Firestore),
    clock: { now: () => '2026-10-06T00:00:00Z', localDate: () => '2026-10-06' },
    ids: { transactionId: key => `transaction-${key}`, eventId: (key, type) => `${key}-${type}` },
    events: { async publish() {} },
  });
}

describe('[REC-006][T-REC-007] 실제 등록 handler와 Firebase scheduler creator', () => {
  it('payload의 creator를 받지 않고 다른 가구원의 일반 수정 뒤에도 최초 creator로 거래를 만든다', async () => {
    const memory = new InMemoryFirestore();
    memory.seed('households/house/categories/fixed', { categoryId: 'fixed', name: '고정비', color: '#112233', state: 'active', version: 1 });
    const handlers = createRecurringHouseholdCommandHandlers(memory as unknown as Firestore);
    const execute = (command: string, id: string, member: string, payload: Record<string, unknown>) => handlers.get(command)!.execute({
      principalUid: `uid-${member}`, requestedAt: '2026-09-06T00:00:00Z',
      actor: { principalUid: `uid-${member}`, householdId: 'house', actingMemberId: member, capabilities: ['household.write'] },
      envelope: { contractVersion: 'household-command.v1', householdId: 'house', command, commandId: id, idempotencyKey: id, payload },
    });
    const created = await execute('recurring.create-plan.v1', 'create', 'first-member', { creatorMemberId: 'forged', plan: { merchant: '정기', amount: 1000, category: 'fixed', dayOfMonth: 1, creatorMemberId: 'forged' } }) as { planId: string };
    await execute('recurring.update-plan.v1', 'update', 'second-member', { planId: created.planId, expectedVersion: 1, changes: { amount: 1200, creatorMemberId: 'second-member' } });
    expect(memory.document(`households/house/recurringPlans/${created.planId}`)).toMatchObject({ creatorMemberId: 'first-member', amountInWon: 1200 });
    const result = await scheduler(memory).processMonth({ actor: { kind: 'system', capabilities: ['recurring.process'] }, householdId: 'house', planId: created.planId, targetMonth: '2026-10' });
    expect(result).toMatchObject({ kind: 'created' });
    expect(memory.documentsInCollection('households/house/ledgerTransactions').map(document => document.value)).toEqual([
      expect.objectContaining({ creatorMemberId: 'first-member', amountInWon: 1200 }),
    ]);
  });

  it('creator 없는 실제 legacy Plan은 현재 actor를 추정하지 않고 자동 거래를 만들지 않는다', async () => {
    const memory = new InMemoryFirestore();
    memory.seed('recurring_expenses/legacy', { householdId: 'house', merchant: 'Legacy', category: 'fixed', amount: 1000, dayOfMonth: 1, firstApplicableMonth: '2026-09', isActive: true });
    const before = memory.paths('');
    expect(await scheduler(memory).processDue({ actor: { kind: 'system', capabilities: ['recurring.process'] }, asOfDate: '2026-09-06', householdZoneId: 'Asia/Seoul', limit: 10 })).toMatchObject({ kind: 'success', results: [] });
    expect(memory.paths('')).toEqual(before);
    expect(memory.document('recurring_expenses/legacy')).not.toHaveProperty('creatorMemberId');
  });

  it('실제 migration builder는 기존 유효 creator를 바꾸는 명시 mapping을 차단한다', async () => {
    const memory = new InMemoryFirestore();
    memory.seed('households/house', { lifecycleState: 'active' });
    for (const member of ['first-member', 'second-member']) memory.seed(`households/house/members/${member}`, { memberId: member });
    memory.seed('recurring_expenses/legacy', { householdId: 'house', merchant: 'Legacy', category: 'fixed', amount: 1000, dayOfMonth: 1, firstApplicableMonth: '2026-09', creatorMemberId: 'first-member', isActive: true });
    const before = memory.paths('');
    const builder = new FirebaseRuntimeMigrationPlanBuilder(memory as unknown as Firestore, 'demo-creator');
    const candidate = await builder.build({
      scope: { projectId: 'demo-creator', householdId: 'house', migrationId: 'creator-conflict', migrationKind: RUNTIME_MIGRATION_KIND, schemaScope: RUNTIME_MIGRATION_SCHEMA_SCOPE, operatorId: 'operator' },
      mappings: { version: 1, householdIdHash: createHash('sha256').update('house').digest('hex'), recurringCreators: { legacy: 'second-member' } },
      plannedAt: '2026-09-06T00:00:00Z',
    });
    expect(candidate.unresolved).toContainEqual(expect.objectContaining({ code: 'SOURCE_DOCUMENT_INVALID', sourceCollection: 'recurring_expenses', detailCode: 'RECURRING_CREATOR_MAPPING_CONFLICT' }));
    expect(candidate.candidates.filter(item => item.logicalCollection === 'recurring' || item.logicalCollection === 'recurring-creator-receipt')).toEqual([]);
    expect(memory.paths('')).toEqual(before);
    expect(memory.document('recurring_expenses/legacy')).toMatchObject({ creatorMemberId: 'first-member' });
  });
});

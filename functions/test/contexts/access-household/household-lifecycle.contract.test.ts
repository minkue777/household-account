import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createHouseholdLifecycleApplication } from '../../../src/contexts/access/household-lifecycle/application/householdLifecycleApplication';
import type { HouseholdLifecycleState } from '../../../src/contexts/access/household-lifecycle/domain/model/householdLifecycle';

const actor = { principalRef: 'admin', capabilities: ['household.restore'] as const };
const command = { householdId: 'house', reason: '오삭제 복구', expectedVersion: 8, idempotencyKey: 'restore' };
function setup(lifecycleState: HouseholdLifecycleState['household']['lifecycleState'] = 'deleted') {
  let state: HouseholdLifecycleState = { household: { householdId: 'house', lifecycleState, aggregateVersion: 8,
    deletedAt: '2026-07-19T09:00:00Z', deletedByHash: 'previous-admin' }, receipts: [], events: [] };
  const application = createHouseholdLifecycleApplication({
    unitOfWork: { async transact(operation) { const mutation = operation(structuredClone(state)); state = mutation.state; return mutation.value; } },
    clock: { now: () => '2026-07-20T09:00:00Z' },
    hash: { hashSensitiveReference: value => createHash('sha256').update(value).digest('hex') },
  });
  return { application, snapshot: () => structuredClone(state) };
}

describe('가구 복구의 상태 전이 계약; 실제 삭제·접근 차단·purge는 Firebase 통합 검사에서 확인', () => {
  it('[T-ADM-002][ADM-003] 같은 ID 복구는 삭제 표시를 지우고 version과 원자 receipt/event를 한 번 갱신한다', async () => {
    const subject = setup();
    const result = await subject.application.restoreDeletedHousehold(actor, command);
    expect(result).toEqual({ kind: 'success', household: { householdId: 'house', lifecycleState: 'active', aggregateVersion: 9 } });
    expect(subject.snapshot().household).not.toHaveProperty('deletedAt');
    expect(subject.snapshot().household).not.toHaveProperty('deletedByHash');
    expect(subject.snapshot().events).toEqual([{ eventType: 'HouseholdRestored.v1', householdId: 'house',
      restoredAt: '2026-07-20T09:00:00Z', restoredByHash: createHash('sha256').update('admin').digest('hex') }]);
    const after = subject.snapshot();
    expect(await subject.application.restoreDeletedHousehold(actor, command)).toEqual(result);
    expect(subject.snapshot()).toEqual(after);
    expect(await subject.application.restoreDeletedHousehold(actor, { ...command, reason: '다른 사유' }))
      .toEqual({ kind: 'conflict', code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
    expect(subject.snapshot()).toEqual(after);
  });
  it.each(['purging', 'purged'] as const)('[T-ADM-002][ADM-003] %s 상태는 복구하지 않는다', async state => {
    const subject = setup(state); const before = subject.snapshot();
    expect(await subject.application.restoreDeletedHousehold(actor, command)).toEqual({ kind: 'conflict', code: 'PURGE_ALREADY_STARTED' });
    expect(subject.snapshot()).toEqual(before);
  });
  it('[T-ADM-002][ADM-003] 권한·범위·사유·버전 거절은 원본과 receipt/event를 보존한다', async () => {
    const subject = setup(); const before = subject.snapshot();
    expect(await subject.application.restoreDeletedHousehold({ ...actor, capabilities: [] }, command)).toEqual({ kind: 'forbidden', code: 'HOUSEHOLD_RESTORE_REQUIRED' });
    expect(await subject.application.restoreDeletedHousehold(actor, { ...command, householdId: 'other' })).toEqual({ kind: 'conflict', code: 'HOUSEHOLD_SCOPE_MISMATCH' });
    expect(await subject.application.restoreDeletedHousehold(actor, { ...command, reason: ' ' })).toEqual({ kind: 'conflict', code: 'RESTORE_REASON_REQUIRED' });
    expect(await subject.application.restoreDeletedHousehold(actor, { ...command, expectedVersion: 7 })).toEqual({ kind: 'conflict', code: 'VERSION_MISMATCH', currentVersion: 8 });
    expect(subject.snapshot()).toEqual(before);
  });
  it('[T-ADM-002][ADM-003] 이미 active이면 버전·event를 바꾸지 않고 멱등 결과만 저장한다', async () => {
    const subject = setup('active');
    expect(await subject.application.restoreDeletedHousehold(actor, command)).toMatchObject({ kind: 'already-processed', household: { aggregateVersion: 8 } });
    expect(subject.snapshot().events).toEqual([]);
    expect(subject.snapshot().receipts).toHaveLength(1);
  });
});

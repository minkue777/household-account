import { startAndroidQuickEditUpdates } from '@/composition/androidQuickEditUpdates';
import { clearClientSessionScope, getClientSessionScope, setClientSessionScope } from '@/composition/clientSessionScope';
import { ledgerOptimisticProjection } from '@/features/ledger/application/ledgerOptimisticProjection';
import { QUICK_EDIT_UPDATES_CHANGED_EVENT, readQuickEditUpdateFeedback } from '@/platform/android-host/quickEditUpdateFeedback';
import type { Expense } from '@/types/expense';

const identity = { principalUid: 'uid-1', householdId: 'house-1', memberId: 'member-1' };
const original: Expense = { id: 'expense-1', aggregateVersion: 1, date: '2026-09-28',
  merchant: '마트', amount: 1_000, category: 'etc', memo: '이전', tags: ['이전'] };
const pending = { commandId: 'android:edit-1', transactionId: original.id, expectedVersion: 1,
  patch: { memo: '수정', tags: [] }, state: 'pending' };
const succeeded = { ...pending, state: 'succeeded', transaction: { transactionId: original.id,
  householdId: identity.householdId, aggregateVersion: 2, merchant: original.merchant,
  memo: '수정', tags: [], amountInWon: 1_000, categoryId: 'etc', accountingDate: original.date,
  localTime: '12:00', transactionType: 'expense', lifecycleState: 'active', cardType: 'manual',
  cardDisplay: '수동', creatorMemberId: identity.memberId } };
const snapshot = (updates: unknown[]) => ({ contractVersion: 'quick-edit-update-feedback.v1',
  ...identity, nativeSessionGeneration: 91, updates });
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe('T-QE-009 actual Web bridge -> shared ledger projection', () => {
  const cleanup: Array<() => void> = [];
  type Request = { requestId: string; operation: string; payload: Record<string, unknown> };
  let requests: Request[];
  function reply(request: Request, value: unknown, error?: string) {
    window.HouseholdNativeBridge!.onmessage!({ data: JSON.stringify({
      contractVersion: 'android-bridge-response.v1', requestId: request.requestId,
      result: error ? { kind: 'rejected', error: { code: error } } : { kind: 'succeeded', value },
    }) });
  }
  function setup() {
    const render = jest.fn();
    const source = ledgerOptimisticProjection.subscribe(render, () => true, identity.householdId);
    source.publish([original]);
    const stop = startAndroidQuickEditUpdates(getClientSessionScope()!);
    cleanup.push(stop, () => source.dispose());
    return { render, source, stop };
  }
  beforeEach(() => {
    requests = [];
    setClientSessionScope({ ...identity, sessionGeneration: 2 }); // unrelated to Native generation 91
    window.HouseholdNativeBridge = { onmessage: null, postMessage: (message) => {
      const request: Request = JSON.parse(message);
      requests.push(request);
      if (request.operation === 'quick-edit.ack-update-feedback') reply(request, {});
    } };
  });
  afterEach(() => {
    cleanup.splice(0).forEach((stop) => stop());
    // Clear remaining bridge request timers with a normal rejection.
    requests.forEach((request) => reply(request, {}, 'TEST_FINISHED'));
    delete window.HouseholdNativeBridge;
    clearClientSessionScope();
    ledgerOptimisticProjection.reset();
  });

  it('서버 완료가 없는 local pending 응답만으로 목록을 바꾸고 실제 canonical 뒤 ack한다', async () => {
    const { render, source } = setup();
    expect(requests[0].payload).toEqual(identity);
    reply(requests[0], snapshot([pending]));
    await tick();
    expect(render).toHaveBeenLastCalledWith([expect.objectContaining({ memo: '수정', tags: [] })]);
    expect(requests).toHaveLength(1);
    window.dispatchEvent(new Event(QUICK_EDIT_UPDATES_CHANGED_EVENT));
    reply(requests[1], snapshot([succeeded]));
    await tick();
    expect(requests[2]).toEqual(expect.objectContaining({ operation: 'quick-edit.ack-update-feedback',
      payload: { ...identity, nativeSessionGeneration: 91, commandIds: [pending.commandId] } }));
    source.publish([original]);
    expect(render).toHaveBeenLastCalledWith([expect.objectContaining({ memo: '수정', aggregateVersion: 2 })]);
  });

  it('조회중 변경이 오면 완료 직후 한번 더 읽어 실패 복구를 놓치지 않는다', async () => {
    const { render } = setup();
    window.dispatchEvent(new Event(QUICK_EDIT_UPDATES_CHANGED_EVENT));
    window.dispatchEvent(new Event(QUICK_EDIT_UPDATES_CHANGED_EVENT));
    expect(requests).toHaveLength(1);
    reply(requests[0], snapshot([pending]));
    await tick();
    expect(requests).toHaveLength(2);
    expect(render).toHaveBeenLastCalledWith([expect.objectContaining({ memo: '수정' })]);
    reply(requests[1], snapshot([{ ...pending, state: 'failed' }]));
    await tick();
    expect(render).toHaveBeenLastCalledWith([original]);
  });

  it('같은 identity라도 Web 인증 세대가 바뀌면 이전 응답을 무시한다', async () => {
    const { render, stop } = setup();
    setClientSessionScope({ ...identity, sessionGeneration: 3 });
    reply(requests[0], snapshot([pending]));
    await tick();
    expect(render).toHaveBeenLastCalledWith([original]);
    stop();
    cleanup.push(startAndroidQuickEditUpdates(getClientSessionScope()!));
    reply(requests[1], snapshot([pending]));
    await tick();
    expect(render).toHaveBeenLastCalledWith([expect.objectContaining({ memo: '수정' })]);
  });

  it('지원하지 않는 구 APK에서도 기존 서버 목록을 유지한다', async () => {
    const { render, source } = setup();
    reply(requests[0], {}, 'UNKNOWN_OPERATION');
    await tick();
    source.publish([{ ...original, memo: '서버 변경', aggregateVersion: 2 }]);
    expect(render).toHaveBeenLastCalledWith([expect.objectContaining({ memo: '서버 변경' })]);
    expect(requests).toHaveLength(1);
  });

  it('세션 reset 뒤 이전 Native observer가 새 원장에 pending을 다시 넣지 않는다', async () => {
    setup();
    reply(requests[0], snapshot([pending]));
    await tick();
    setClientSessionScope({ ...identity, memberId: 'member-2', sessionGeneration: 3 });
    ledgerOptimisticProjection.reset();
    const render = jest.fn();
    const source = ledgerOptimisticProjection.subscribe(render, () => true, identity.householdId);
    cleanup.push(() => source.dispose());
    source.publish([original]);
    expect(render).toHaveBeenLastCalledWith([original]);
  });

  it('다른 가구·멤버·사용자와 손상된 canonical은 표시나 ack에 사용하지 않는다', async () => {
    const { render } = setup();
    reply(requests[0], { ...snapshot([pending]), principalUid: 'another-user' });
    await tick();
    expect(render).toHaveBeenLastCalledWith([original]);
    expect(requests).toHaveLength(1);
    for (const field of ['householdId', 'memberId', 'principalUid']) {
      expect(readQuickEditUpdateFeedback({ ...snapshot([pending]), [field]: 'another' }, identity)).toBeUndefined();
    }
    expect(readQuickEditUpdateFeedback(snapshot([{ ...succeeded, transaction: { ...succeeded.transaction, householdId: 'another' } }]), identity)).toBeUndefined();
    expect(readQuickEditUpdateFeedback(snapshot([pending, pending]), identity)).toBeUndefined();
  });
});

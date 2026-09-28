import { LedgerOptimisticProjection } from '@/features/ledger/application/ledgerOptimisticProjection';
import { QuickEditLedgerFeedback } from '@/features/ledger/application/quickEditLedgerFeedback';
import type { QuickEditUpdateFeedback, QuickEditUpdateFeedbackSnapshot } from '@/platform/android-host/quickEditUpdateFeedback';
import type { Expense } from '@/types/expense';

const original: Expense = {
  id: 'expense-1', aggregateVersion: 3, date: '2026-09-28', time: '12:00',
  merchant: '주유소', memo: '이전 메모', amount: 10_000, category: 'etc',
  tags: ['이전'], cardType: 'captured', cardLastFour: '삼성(1234)',
};
const pending: QuickEditUpdateFeedback = {
  commandId: 'android:edit-1', transactionId: original.id, expectedVersion: 3,
  patch: { memo: '새 메모', categoryId: '생활비', amountInWon: 9_000, tags: [] }, state: 'pending',
};
const succeeded: QuickEditUpdateFeedback = { ...pending, state: 'succeeded', transaction: {
  transactionId: original.id, householdId: 'house-1', aggregateVersion: 4,
  transactionType: 'expense', merchant: original.merchant, memo: '새 메모', amountInWon: 9_000,
  categoryId: '생활비', accountingDate: original.date, localTime: '12:00', cardType: 'captured',
  cardDisplay: '삼성(1234)', creatorMemberId: 'member-1', lifecycleState: 'active', tags: [],
} };
function snapshot(updates: QuickEditUpdateFeedback[], nativeSessionGeneration = 19): QuickEditUpdateFeedbackSnapshot {
  return { contractVersion: 'quick-edit-update-feedback.v1', principalUid: 'uid-1',
    householdId: 'house-1', memberId: 'member-1', nativeSessionGeneration, updates };
}
function setup() {
  const projection = new LedgerOptimisticProjection();
  const render = jest.fn();
  const source = projection.subscribe(render, () => true, 'house-1', 'month');
  source.publish([original]);
  const ack = jest.fn();
  const feedback = new QuickEditLedgerFeedback(projection, 'house-1', ack);
  return { projection, render, source, ack, feedback };
}

describe('T-QE-009 QuickEdit uses the ordinary ledger optimistic lifecycle', () => {
  it('서버 응답 없이 메모·카테고리·금액·태그 제거를 월/연 목록에 즉시 표시한다', () => {
    const { projection, render, ack, feedback } = setup();
    const yearly = jest.fn();
    projection.subscribe(yearly, () => true, 'house-1').publish([original]);
    feedback.receive(snapshot([pending]));
    const expected = [expect.objectContaining({ memo: '새 메모', category: '생활비', amount: 9_000, tags: [], aggregateVersion: 4 })];
    expect(render).toHaveBeenLastCalledWith(expected);
    expect(yearly).toHaveBeenLastCalledWith(expected);
    expect(ack).not.toHaveBeenCalled();
    feedback.receive(snapshot([pending])); // retryable delivery and repeated resume
    expect(render).toHaveBeenLastCalledWith(expected);
    expect(projection.current(original.id, 'house-1')?.aggregateVersion).toBe(4);
  });

  it('성공 응답을 공통 commit으로 확정해 늦은 서버 snapshot/재진입에서 되돌리지 않는다', () => {
    const { projection, render, source, ack, feedback } = setup();
    feedback.receive(snapshot([pending]));
    feedback.receive(snapshot([succeeded]));
    expect(ack).toHaveBeenLastCalledWith([pending.commandId], 19);
    feedback.receive(snapshot([])); // Native acknowledged and dropped its completion
    source.publish([original]);
    expect(render).toHaveBeenLastCalledWith([expect.objectContaining({ memo: '새 메모', aggregateVersion: 4 })]);
    source.dispose();
    const next = projection.subscribe(render, () => true, 'house-1', 'month');
    next.publish([original]);
    expect(render).toHaveBeenLastCalledWith([expect.objectContaining({ memo: '새 메모', aggregateVersion: 4 })]);
    next.publish([{ ...original, memo: '다른 최신 수정', aggregateVersion: 5 }]);
    expect(render).toHaveBeenLastCalledWith([expect.objectContaining({ memo: '다른 최신 수정', aggregateVersion: 5 })]);
  });

  it('서버 충돌/거부는 해당 overlay만 제거하고 더 최신 원장과 다른 편집을 보존한다', () => {
    const { projection, render, source, feedback } = setup();
    const second = { ...original, id: 'expense-2' };
    source.publish([original, second]);
    projection.beginUpdate(second.id, { memo: '일반 편집' }, 'house-1');
    feedback.receive(snapshot([pending]));
    source.publish([{ ...original, memo: '다른 기기의 변경', aggregateVersion: 5 }, second]);
    // Even before the conflict response, the old native patch cannot mask version 5.
    expect(render.mock.calls.at(-1)?.[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: original.id, memo: '다른 기기의 변경', aggregateVersion: 5 }),
    ]));
    feedback.receive(snapshot([{ ...pending, state: 'failed' }]));
    expect(render.mock.calls.at(-1)?.[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: original.id, memo: '다른 기기의 변경', aggregateVersion: 5 }),
      expect.objectContaining({ id: second.id, memo: '일반 편집' }),
    ]));
  });

  it('첫 서버 목록보다 먼저 받은 pending도 실제 목록 도착 시 적용된다', () => {
    const projection = new LedgerOptimisticProjection();
    const feedback = new QuickEditLedgerFeedback(projection, 'house-1', jest.fn());
    feedback.receive(snapshot([pending]));
    const render = jest.fn();
    const source = projection.subscribe(render, () => true, 'house-1');
    source.publish([original]);
    expect(render).toHaveBeenLastCalledWith([expect.objectContaining({ memo: '새 메모', aggregateVersion: 4 })]);
  });

  it('화면이 없을 때 완료된 수정은 canonical로 반영하고 이미 최신이면 역전하지 않는다', () => {
    const { render, source, feedback } = setup();
    source.publish([{ ...original, memo: '더 최신', aggregateVersion: 6 }]);
    feedback.receive(snapshot([succeeded]));
    expect(render).toHaveBeenLastCalledWith([expect.objectContaining({ memo: '더 최신', aggregateVersion: 6 })]);
  });

  it('일반 편집이 먼저 진행 중이면 건드리지 않고 완료된 뒤 Native 변경을 처리한다', () => {
    const { projection, render, feedback } = setup();
    const webMutation = projection.beginUpdate(original.id, { memo: '일반 편집 중' }, 'house-1');
    feedback.receive(snapshot([pending]));
    expect(render).toHaveBeenLastCalledWith([expect.objectContaining({ memo: '일반 편집 중' })]);
    projection.rollback(webMutation);
    expect(render).toHaveBeenLastCalledWith([expect.objectContaining({ memo: '새 메모' })]);
  });

  it('Native 세션 교체·전달목록 제거·dispose는 자신의 pending만 복구한다', () => {
    const { render, feedback } = setup();
    feedback.receive(snapshot([pending]));
    feedback.receive(snapshot([], 20));
    expect(render).toHaveBeenLastCalledWith([original]);
    feedback.receive(snapshot([pending], 20));
    feedback.dispose();
    expect(render).toHaveBeenLastCalledWith([original]);
  });

  it.each(['before-pending', 'while-pending', 'after-success'])('다른 기기 삭제 뒤 늦은 Native 성공이 거래를 복원하지 않는다: %s', (timing) => {
    const { projection, render, source, feedback } = setup();
    const yearly = projection.subscribe(jest.fn(), () => true, 'house-1');
    yearly.publish([original]); // A second read may still have an old row.
    if (timing !== 'before-pending') feedback.receive(snapshot([pending]));
    if (timing === 'after-success') feedback.receive(snapshot([succeeded]));
    source.publish([]);
    feedback.receive(snapshot([succeeded]));
    expect(render).toHaveBeenLastCalledWith([]);
    source.publish([]);
    expect(render).toHaveBeenLastCalledWith([]);
  });
});

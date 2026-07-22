import { LedgerOptimisticProjection } from '@/features/ledger/application/ledgerOptimisticProjection';
import type { Expense } from '@/types/expense';

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'expense-1',
    aggregateVersion: 3,
    date: '2026-07-22',
    time: '12:00',
    merchant: '기존 가맹점',
    amount: 10_000,
    transactionType: 'expense',
    category: 'etc',
    cardType: 'main',
    cardLastFour: '삼성(1876)',
    memo: '기존 메모',
    ...overrides,
  };
}

describe('Ledger optimistic projection contract', () => {
  it('새 거래를 서버 응답 전에 즉시 표시하고 실패하면 제거한다', () => {
    const projection = new LedgerOptimisticProjection();
    const callback = jest.fn();
    const subscription = projection.subscribe(callback, () => true);
    subscription.publish([]);

    const mutationId = projection.beginCreate(expense());
    expect(callback).toHaveBeenLastCalledWith([expense()]);

    projection.rollback(mutationId);
    expect(callback).toHaveBeenLastCalledWith([]);
  });

  it('월간·연간 등 여러 read 구독에 같은 pending 변경을 동시에 투영한다', () => {
    const projection = new LedgerOptimisticProjection();
    const monthly = jest.fn();
    const yearly = jest.fn();
    const monthlySubscription = projection.subscribe(
      monthly,
      (item) => item.date.startsWith('2026-07')
    );
    const yearlySubscription = projection.subscribe(
      yearly,
      (item) => item.date.startsWith('2026-')
    );
    monthlySubscription.publish([expense()]);
    yearlySubscription.publish([expense()]);
    monthly.mockClear();
    yearly.mockClear();

    projection.beginUpdate('expense-1', { memo: '모든 화면에 즉시 반영' });

    expect(monthly).toHaveBeenLastCalledWith([
      expect.objectContaining({ memo: '모든 화면에 즉시 반영' }),
    ]);
    expect(yearly).toHaveBeenLastCalledWith([
      expect.objectContaining({ memo: '모든 화면에 즉시 반영' }),
    ]);
  });

  it('한 구독의 최신 snapshot이 먼저 와도 다른 구독을 예전 값으로 되돌리지 않는다', () => {
    const projection = new LedgerOptimisticProjection();
    const monthly = jest.fn();
    const yearly = jest.fn();
    const monthlySubscription = projection.subscribe(monthly, () => true);
    const yearlySubscription = projection.subscribe(yearly, () => true);
    monthlySubscription.publish([expense()]);
    yearlySubscription.publish([expense()]);

    const mutationId = projection.beginUpdate('expense-1', { memo: '확정 메모' });
    projection.commitUpdate(
      mutationId,
      expense({ aggregateVersion: 4, memo: '확정 메모' })
    );
    monthlySubscription.publish([
      expense({ aggregateVersion: 4, memo: '확정 메모' }),
    ]);

    expect(yearly).toHaveBeenLastCalledWith([
      expect.objectContaining({ aggregateVersion: 4, memo: '확정 메모' }),
    ]);

    yearlySubscription.publish([
      expense({ aggregateVersion: 4, memo: '확정 메모' }),
    ]);
    expect(yearly).toHaveBeenLastCalledWith([
      expect.objectContaining({ aggregateVersion: 4, memo: '확정 메모' }),
    ]);
  });

  it('날짜가 조회 범위를 벗어나면 서버 응답 전 기존 목록에서 제거한다', () => {
    const projection = new LedgerOptimisticProjection();
    const callback = jest.fn();
    const subscription = projection.subscribe(
      callback,
      (item) => item.date.startsWith('2026-07')
    );
    subscription.publish([expense()]);

    projection.beginUpdate('expense-1', { date: '2026-08-01' });

    expect(callback).toHaveBeenLastCalledWith([]);
  });

  it('서버 응답을 기다리지 않고 같은 tick에 수정값을 표시한다', () => {
    const projection = new LedgerOptimisticProjection();
    const callback = jest.fn();
    const subscription = projection.subscribe(callback, () => true);
    subscription.publish([expense()]);
    callback.mockClear();

    projection.beginUpdate('expense-1', { memo: '새 메모', amount: 20_000 });

    expect(callback).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'expense-1', memo: '새 메모', amount: 20_000 }),
    ]);
  });

  it('서버 실패 시 최신 authoritative base에서 해당 변경만 원복한다', () => {
    const projection = new LedgerOptimisticProjection();
    const callback = jest.fn();
    const subscription = projection.subscribe(callback, () => true);
    subscription.publish([expense()]);

    const mutationId = projection.beginUpdate('expense-1', { memo: '실패할 메모' });
    subscription.publish([expense({ merchant: '다른 화면에서 바뀐 가맹점' })]);
    projection.rollback(mutationId);

    expect(callback).toHaveBeenLastCalledWith([
      expect.objectContaining({
        merchant: '다른 화면에서 바뀐 가맹점',
        memo: '기존 메모',
      }),
    ]);
  });

  it('삭제는 즉시 숨기고 서버 실패 시 복원한다', () => {
    const projection = new LedgerOptimisticProjection();
    const callback = jest.fn();
    const subscription = projection.subscribe(callback, () => true);
    subscription.publish([expense()]);

    const mutationId = projection.beginDelete('expense-1');
    expect(callback).toHaveBeenLastCalledWith([]);

    projection.rollback(mutationId);
    expect(callback).toHaveBeenLastCalledWith([expense()]);
  });

  it('성공 snapshot 전에는 canonical 결과를 유지하고 확인 후 overlay를 제거한다', () => {
    const projection = new LedgerOptimisticProjection();
    const callback = jest.fn();
    const subscription = projection.subscribe(callback, () => true);
    subscription.publish([expense()]);

    const mutationId = projection.beginUpdate('expense-1', { memo: '새 메모' });
    projection.commitUpdate(mutationId, expense({ aggregateVersion: 4, memo: '새 메모' }));
    subscription.publish([expense()]);
    expect(callback).toHaveBeenLastCalledWith([
      expect.objectContaining({ aggregateVersion: 4, memo: '새 메모' }),
    ]);

    subscription.publish([expense({ aggregateVersion: 4, memo: '새 메모' })]);
    expect(callback).toHaveBeenLastCalledWith([
      expect.objectContaining({ aggregateVersion: 4, memo: '새 메모' }),
    ]);
  });

  it('같은 거래의 동시 pending 명령은 차단하고 다른 거래는 허용한다', () => {
    const projection = new LedgerOptimisticProjection();
    projection.beginUpdate('expense-1', { memo: '첫 변경' });

    expect(() => projection.beginDelete('expense-1'))
      .toThrow('LEDGER_MUTATION_ALREADY_PENDING');
    expect(() => projection.beginDelete('expense-2')).not.toThrow();
  });

  it('does not expose a pending transaction to another household projection', () => {
    const projection = new LedgerOptimisticProjection();
    const firstHousehold = jest.fn();
    const secondHousehold = jest.fn();
    const first = projection.subscribe(firstHousehold, () => true, 'household-a');
    const second = projection.subscribe(secondHousehold, () => true, 'household-b');
    first.publish([]);
    second.publish([]);

    projection.beginCreate(expense(), 'household-a');

    expect(firstHousehold).toHaveBeenLastCalledWith([expense()]);
    expect(secondHousehold).toHaveBeenLastCalledWith([]);
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import type { SplitItem } from '@/lib/expenseService';
import type { Expense } from '@/types/expense';

const mockRunSplitMonthsAction = jest.fn().mockResolvedValue(undefined);
const mockRunCancelSplitGroupAction = jest.fn().mockResolvedValue(undefined);
const mockRunUpdateSplitGroupAction = jest.fn().mockResolvedValue(undefined);
const mockNotifyPartner = jest.fn().mockResolvedValue(undefined);

const mockExpenseEditModal = jest.fn((props: {
  expense: Expense;
  onClose: () => void;
  onSave: (updates: { memo?: string }) => void;
  onOpenSplit?: () => void;
  onSplitMonths?: (months: number) => void;
  onCancelSplitGroup?: () => void;
  onUpdateSplitGroup?: (months: number) => void;
  onDelete?: () => void;
  onUnmerge?: () => void;
  onNotifyPartner?: () => Promise<void>;
}) => (
  <div data-testid="expense-edit-modal" data-expense-id={props.expense.id}>
    <button aria-label="편집 저장" onClick={() => props.onSave({ memo: '수정됨' })} />
    <button aria-label="편집 삭제" onClick={() => props.onDelete?.()} />
    <button aria-label="합치기 되돌리기" onClick={() => props.onUnmerge?.()} />
    <button aria-label="항목 분리" onClick={() => props.onOpenSplit?.()} />
    <button aria-label="월 분할" onClick={() => props.onSplitMonths?.(3)} />
    <button aria-label="월 분할 취소" onClick={() => props.onCancelSplitGroup?.()} />
    <button aria-label="월 분할 재구성" onClick={() => props.onUpdateSplitGroup?.(4)} />
    <button
      aria-label="알림 보내기"
      onClick={() => {
        void props.onNotifyPartner?.();
      }}
    />
    <button aria-label="편집 닫기" onClick={props.onClose} />
  </div>
));

const mockExpenseSplitModal = jest.fn((props: {
  expense: Expense;
  onClose: () => void;
  onSave: (splits: SplitItem[]) => void;
}) => (
  <div data-testid="expense-split-modal" data-expense-id={props.expense.id}>
    <button
      aria-label="분리 저장"
      onClick={() =>
        props.onSave([
          { merchant: '분리 1', amount: 4_000, category: 'food' },
          { merchant: '분리 2', amount: 6_000, category: 'food' },
        ])
      }
    />
    <button aria-label="분리 닫기" onClick={props.onClose} />
  </div>
));

jest.mock('@/contexts/CategoryContext', () => ({
  useCategoryContext: () => ({
    getCategoryLabel: (category: string) => category,
    getCategoryColor: () => '#000000',
  }),
}));

jest.mock('@/lib/utils/monthlySplitActions', () => ({
  runSplitMonthsAction: (...args: unknown[]) => mockRunSplitMonthsAction(...args),
  runCancelSplitGroupAction: (...args: unknown[]) => mockRunCancelSplitGroupAction(...args),
  runUpdateSplitGroupAction: (...args: unknown[]) => mockRunUpdateSplitGroupAction(...args),
}));

jest.mock('@/lib/partnerNotificationService', () => ({
  notifyPartner: (...args: unknown[]) => mockNotifyPartner(...args),
}));

jest.mock('@/components/expense/ExpenseEditModal', () => ({
  __esModule: true,
  default: (props: Parameters<typeof mockExpenseEditModal>[0]) => mockExpenseEditModal(props),
}));

jest.mock('@/components/expense/ExpenseSplitModal', () => ({
  __esModule: true,
  default: (props: Parameters<typeof mockExpenseSplitModal>[0]) => mockExpenseSplitModal(props),
}));

import ExpenseDetail from '@/components/expense/ExpenseDetail';

const expense = (id: string, merchant: string, overrides: Partial<Expense> = {}): Expense => ({
  id,
  aggregateVersion: 7,
  date: '2026-07-22',
  time: '12:30',
  merchant,
  amount: 10_000,
  category: 'food',
  ...overrides,
});

const firstExpense = expense('expense-1', '첫째 상점');
const secondExpense = expense('expense-2', '둘째 상점');

const defaultProps = {
  date: '2026-07-22',
  expenses: [firstExpense, secondExpense],
  transactionType: 'expense' as const,
};

describe('ExpenseDetail 모달 소유권 계약', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('행 수와 무관하게 닫힌 모달을 만들지 않고 선택된 항목의 모달 하나만 연다', () => {
    render(<ExpenseDetail {...defaultProps} />);

    expect(mockExpenseEditModal).not.toHaveBeenCalled();
    expect(mockExpenseSplitModal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('둘째 상점'));

    expect(screen.getAllByTestId('expense-edit-modal')).toHaveLength(1);
    expect(screen.getByTestId('expense-edit-modal')).toHaveAttribute(
      'data-expense-id',
      secondExpense.id
    );

    fireEvent.click(screen.getByText('첫째 상점'));

    expect(screen.getAllByTestId('expense-edit-modal')).toHaveLength(1);
    expect(screen.getByTestId('expense-edit-modal')).toHaveAttribute(
      'data-expense-id',
      firstExpense.id
    );
  });

  test('Quick Edit 대상이 목록에 나타나면 그 항목 하나를 자동으로 열고 처리 완료를 한 번 알린다', async () => {
    const onAutoEditHandled = jest.fn();
    const { rerender } = render(
      <ExpenseDetail
        {...defaultProps}
        autoEditExpenseId={secondExpense.id}
        onAutoEditHandled={onAutoEditHandled}
      />
    );

    expect(await screen.findByTestId('expense-edit-modal')).toHaveAttribute(
      'data-expense-id',
      secondExpense.id
    );
    expect(onAutoEditHandled).toHaveBeenCalledTimes(1);

    rerender(
      <ExpenseDetail
        {...defaultProps}
        expenses={[...defaultProps.expenses]}
        autoEditExpenseId={secondExpense.id}
        onAutoEditHandled={onAutoEditHandled}
      />
    );

    expect(onAutoEditHandled).toHaveBeenCalledTimes(1);
  });

  test('선택 항목의 수정·삭제·알림·되돌리기 계약을 그대로 전달한다', async () => {
    const onExpenseUpdate = jest.fn();
    const onDelete = jest.fn();
    const onUnmergeExpense = jest.fn();

    render(
      <ExpenseDetail
        {...defaultProps}
        onExpenseUpdate={onExpenseUpdate}
        onDelete={onDelete}
        onUnmergeExpense={onUnmergeExpense}
      />
    );

    fireEvent.click(screen.getByText('둘째 상점'));
    fireEvent.click(screen.getByRole('button', { name: '편집 저장' }));
    fireEvent.click(screen.getByRole('button', { name: '편집 삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '합치기 되돌리기' }));
    fireEvent.click(screen.getByRole('button', { name: '알림 보내기' }));

    expect(onExpenseUpdate).toHaveBeenCalledWith(secondExpense.id, { memo: '수정됨' });
    expect(onDelete).toHaveBeenCalledWith(secondExpense.id);
    expect(onUnmergeExpense).toHaveBeenCalledWith(secondExpense);
    await waitFor(() => {
      expect(mockNotifyPartner).toHaveBeenCalledWith(
        secondExpense.id,
        secondExpense.aggregateVersion
      );
    });
  });

  test('일반 분리는 편집 모달을 닫고 같은 원본의 분리 모달 하나로 전환한다', () => {
    const onSplitExpense = jest.fn();

    render(
      <ExpenseDetail
        {...defaultProps}
        onSplitExpense={onSplitExpense}
      />
    );

    fireEvent.click(screen.getByText('둘째 상점'));
    fireEvent.click(screen.getByRole('button', { name: '항목 분리' }));

    expect(screen.queryByTestId('expense-edit-modal')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('expense-split-modal')).toHaveLength(1);
    expect(screen.getByTestId('expense-split-modal')).toHaveAttribute(
      'data-expense-id',
      secondExpense.id
    );

    fireEvent.click(screen.getByRole('button', { name: '분리 저장' }));

    expect(onSplitExpense).toHaveBeenCalledWith(secondExpense, [
      { merchant: '분리 1', amount: 4_000, category: 'food' },
      { merchant: '분리 2', amount: 6_000, category: 'food' },
    ]);
  });

  test('월 분할 생성·취소·재구성은 선택된 원본을 월 분할 유스케이스에 전달한다', () => {
    const onDelete = jest.fn();
    const splitExpense = expense('split-expense', '분할 상점', {
      splitGroupId: 'split-group',
      splitIndex: 1,
      splitTotal: 3,
    });
    const { rerender } = render(
      <ExpenseDetail
        {...defaultProps}
        expenses={[firstExpense]}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByText('첫째 상점'));
    fireEvent.click(screen.getByRole('button', { name: '월 분할' }));

    expect(mockRunSplitMonthsAction).toHaveBeenCalledWith({
      expense: firstExpense,
      months: 3,
      deleteExpense: onDelete,
    });

    rerender(
      <ExpenseDetail
        {...defaultProps}
        expenses={[splitExpense]}
        onDelete={onDelete}
      />
    );
    fireEvent.click(screen.getByText('분할 상점'));
    fireEvent.click(screen.getByRole('button', { name: '월 분할 취소' }));
    fireEvent.click(screen.getByRole('button', { name: '월 분할 재구성' }));

    expect(mockRunCancelSplitGroupAction).toHaveBeenCalledWith({ expense: splitExpense });
    expect(mockRunUpdateSplitGroupAction).toHaveBeenCalledWith({
      expense: splitExpense,
      newMonths: 4,
    });
  });

  test('행 간 합치기는 기존 대상·원본 순서를 유지한다', () => {
    const onMergeExpenses = jest.fn();
    render(
      <ExpenseDetail
        {...defaultProps}
        onMergeExpenses={onMergeExpenses}
      />
    );

    fireEvent.drop(screen.getByText('둘째 상점'), {
      dataTransfer: {
        getData: () => firstExpense.id,
      },
    });

    expect(onMergeExpenses).toHaveBeenCalledWith(secondExpense, firstExpense);
  });
});

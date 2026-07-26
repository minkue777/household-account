import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import type { Expense } from '@/types/expense';

jest.mock('@/contexts/CategoryContext', () => ({
  useCategoryContext: () => ({
    activeCategories: [{ key: 'etc', label: '기타', color: '#64748b' }],
    isLoading: false,
    getCategoryLabel: (category: string) => category,
  }),
}));

import ExpenseEditModal from '@/components/expense/ExpenseEditModal';

const mergedExpense: Expense = {
  id: 'merged:merge-command-1',
  aggregateVersion: 1,
  date: '2026-07-26',
  time: '12:00',
  merchant: '합친 지출',
  amount: 14_000,
  transactionType: 'expense',
  category: 'etc',
  mergeLeafIds: ['target', 'source'],
};

describe('[T-MRG-003] 병합 lineage UI 계약', () => {
  test('mergedFrom이 없어도 mergeLeafIds로 되돌리기 UI와 command를 연결한다', () => {
    const onClose = jest.fn();
    const onUnmerge = jest.fn();
    render(
      <ExpenseEditModal
        expense={mergedExpense}
        isOpen
        onClose={onClose}
        onSave={jest.fn()}
        onUnmerge={onUnmerge}
        transactionType="expense"
      />
    );

    expect(screen.getByText('2개의 항목이 합쳐져 있습니다')).toBeInTheDocument();
    expect(screen.getByText('원본 항목은 서버에 안전하게 보존되어 있습니다.'))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '합치기 되돌리기' }));
    fireEvent.click(screen.getByRole('button', { name: '진행' }));

    expect(onUnmerge).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

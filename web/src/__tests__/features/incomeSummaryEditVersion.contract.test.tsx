import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import IncomeSummaryModal from '@/components/expense/IncomeSummaryModal';
import type { Expense } from '@/types/expense';

jest.mock('@/components/expense/ExpenseEditModal', () => ({ __esModule: true, default: ({ onSave, onDelete }: {
  onSave: (changes: { memo: string }) => Promise<void>; onDelete: () => Promise<void>;
}) => <div><button onClick={() => void onSave({ memo: '작성 중인 초안' })}>초안 저장</button>
  <button onClick={() => void onDelete()}>초안 삭제</button></div> }));

test.each(['save', 'delete'])('[LED-005] 수입 요약 %s는 편집을 시작한 버전을 전달한다', async action => {
  const expense: Expense = { id: 'income', aggregateVersion: 1, transactionType: 'income', category: 'salary',
    date: '2026-10-05', merchant: '급여', amount: 1000 };
  const onExpenseUpdate = jest.fn().mockResolvedValue(undefined);
  const onDelete = jest.fn().mockResolvedValue(undefined);
  const props = { isOpen: true, mode: 'monthly' as const, currentYear: 2026, currentMonth: 10, onClose: jest.fn(), onExpenseUpdate, onDelete };
  const { rerender } = render(<IncomeSummaryModal {...props} expenses={[expense]} />);
  fireEvent.click(screen.getByText('급여'));
  rerender(<IncomeSummaryModal {...props} expenses={[{ ...expense, aggregateVersion: 2, memo: '다른 사람의 수정' }]} />);
  fireEvent.click(screen.getByRole('button', { name: action === 'save' ? '초안 저장' : '초안 삭제' }));
  await waitFor(() => {
    if (action === 'save') expect(onExpenseUpdate).toHaveBeenCalledWith('income', { memo: '작성 중인 초안' }, 1);
    else expect(onDelete).toHaveBeenCalledWith('income', 1);
  });
});

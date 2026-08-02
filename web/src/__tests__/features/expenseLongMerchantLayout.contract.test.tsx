import fs from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import ExpenseEditModal from '@/components/expense/ExpenseEditModal';
import type { Expense } from '@/types/expense';

jest.mock('@/contexts/CategoryContext', () => ({
  useCategoryContext: () => ({
    activeCategories: [{ key: 'etc', label: '기타', color: '#64748b' }],
    isLoading: false,
    getCategoryLabel: (category: string) => category,
  }),
}));

const longMerchant = '매우긴가맹점명'.repeat(80);
const expense: Expense = {
  id: 'expense-long-merchant',
  aggregateVersion: 1,
  date: '2026-08-02',
  merchant: longMerchant,
  amount: 10_000,
  transactionType: 'expense',
  category: 'etc',
};

describe('긴 가맹점명 가로 폭 계약', () => {
  test('선택 날짜 grid item이 긴 말줄임 텍스트의 최소 폭을 문서에 전파하지 않는다', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/home/LedgerPage.tsx'),
      'utf8'
    );

    expect(source).toMatch(/selectedDate\s*&&[\s\S]*?'order-3 min-w-0'/);
    expect(source).toMatch(
      /'order-3 min-w-0 lg:col-span-3 lg:col-start-2 lg:row-start-3'/
    );
  });

  test('편집 모달도 긴 원문을 viewport 밖의 가로 스크롤로 노출하지 않는다', () => {
    render(
      <ExpenseEditModal
        expense={expense}
        isOpen
        onClose={jest.fn()}
        onSave={jest.fn()}
        transactionType="expense"
      />
    );

    const dialog = screen.getByRole('dialog', { name: '지출 수정' });
    expect(dialog).toHaveClass('min-w-0', 'overflow-x-hidden');
    expect(dialog.parentElement).toHaveClass('overflow-x-hidden');
    expect(screen.getByDisplayValue(longMerchant)).toBeInTheDocument();
  });
});

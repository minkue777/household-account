import { render, screen, fireEvent } from '@testing-library/react';
import CategoryExpenseModal from '@/components/stats/CategoryExpenseModal';
import { mapExpenseReadData, mapCommandTransaction } from '@/features/ledger/application/ledgerExpenseMapping';
import type { LedgerTransactionCommandResult } from '@/platform/functions-api/householdCommandContract';

jest.mock('@/contexts/CategoryContext', () => ({
  useCategoryContext: () => ({ getCategoryLabel: () => '의류', getCategoryColor: () => '#a855f7' }),
}));

const foreignPayment = {
  currency: 'JPY', amount: 16_248, rateInWon: 8.5, rateDate: '2026-10-30', provider: 'frankfurter-ecb',
};
const stored = { date: '2026-10-30', merchant: '폴로', amountInWon: 138_108, categoryId: 'clothes', foreignPayment };

it('엔화 증거가 있는 거래도 개별 내역과 월 합계 모두 저장된 원화로 표시한다', () => {
  const expense = mapExpenseReadData('japan-1', stored);
  render(<CategoryExpenseModal category="clothes" expenses={[expense, { ...expense, id: 'won', amount: 10000 }]}
    onClose={jest.fn()} onExpenseClick={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /2026년 10월/ }));
  expect(screen.getByText('138,108원')).toBeInTheDocument();
  expect(screen.getByText('10,000원')).toBeInTheDocument();
  expect(screen.getByText('2건 · 148,108원')).toBeInTheDocument();
  expect(screen.queryByText(/16,248|엔|JPY|¥|환율/)).not.toBeInTheDocument();
});

it('조회는 환율로 금액을 재계산하지 않고 원화 반영액을 사용한다', () => {
  const expense = mapExpenseReadData('japan-1', { ...stored, amountInWon: 140000 });
  expect(expense.amount).toBe(140000);
  expect(mapExpenseReadData('japan-1', { ...stored, foreignPayment: { ...foreignPayment, rateInWon: 9 } }).amount)
    .toBe(138108);
});

it('수정 응답의 원화 금액은 외화 증거와 무관하게 화면에 반영한다', () => {
  const expense = mapExpenseReadData('japan-1', stored);
  const response: LedgerTransactionCommandResult & { foreignPayment: typeof foreignPayment } = {
    transactionId: 'japan-1', aggregateVersion: 2, accountingDate: expense.date, merchant: '변경',
    amountInWon: 140000, transactionType: 'expense', categoryId: 'clothes', memo: '',
    cardType: 'captured', cardDisplay: '토스', foreignPayment,
    householdId: 'household-1', localTime: '10:34', creatorMemberId: 'member-1', lifecycleState: 'active',
  };
  expect(mapCommandTransaction(response, expense).amount).toBe(140000);
});

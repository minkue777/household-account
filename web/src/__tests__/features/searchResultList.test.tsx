import { fireEvent, render, screen } from '@testing-library/react';
import SearchResultList from '@/components/search/SearchResultList';
import type { Expense } from '@/types/expense';

jest.mock('@/contexts/CategoryContext', () => ({ useCategoryContext: () => ({
  getCategoryLabel: (id: string) => id === 'food' ? '식비' : '간식',
  getCategoryColor: () => '#123456',
}) }));
const expense = (id: string, date: string, amount: number): Expense => ({
  id, date, amount, aggregateVersion: 1, merchant: `가게 ${id}`, category: 'food', transactionType: 'expense',
});

it('keeps complete source totals and unloaded months while showing only supplied pages, including zero and refunds', () => {
  const rows = [expense('a', '2026-09-02', 100), expense('b', '2026-09-01', -20), expense('c', '2026-08-01', 0)];
  const summary = { count: 90, amount: 1000, months: {
    '2026-09': { count: 60, amount: 500 }, '2026-08': { count: 1, amount: 0 }, '2026-07': { count: 29, amount: 500 },
  } };
  const onExpenseClick = jest.fn();
  const onExpandedMonthChange = jest.fn();
  const props = { keyword: '가게', results: rows, summary, isSearching: false, expandedMonth: '2026-09',
    onExpandedMonthChange, onExpenseClick, transactionType: 'expense' as const };
  const { rerender } = render(<SearchResultList {...props} />);
  expect(screen.getByText('90건 · 1,000원')).toBeInTheDocument();
  expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual([
    '2026년 9월60건500원', '2026년 8월1건0원', '2026년 7월29건500원',
  ]);
  expect(screen.getByText('가게 a')).toBeInTheDocument();
  expect(screen.getByText('가게 b')).toBeInTheDocument();
  expect(screen.queryByText('가게 c')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('가게 b'));
  expect(onExpenseClick).toHaveBeenCalledWith(rows[1]);
  fireEvent.click(screen.getByRole('button', { name: /2026년 7월/ }));
  expect(onExpandedMonthChange).toHaveBeenCalledWith('2026-07');
  rerender(<SearchResultList {...props} expandedMonth="2026-07" />);
  expect(screen.queryByText(/가게 [abc]/)).not.toBeInTheDocument();
  const nextPage = expense('d', '2026-07-20', 50);
  rerender(<SearchResultList {...props} results={[...rows, nextPage]} expandedMonth="2026-07" />);
  expect(screen.getByText('가게 d')).toBeInTheDocument();
  expect(screen.getByText('90건 · 1,000원')).toBeInTheDocument();
  expect(rows).toHaveLength(3);
});

it('updates fallback totals when actual rows change and preserves the expense object passed to the editor', () => {
  const original = expense('a', '2026-09-01', 0);
  const onExpenseClick = jest.fn();
  const props = { keyword: '가게', results: [original], isSearching: false, expandedMonth: '2026-09',
    onExpandedMonthChange: jest.fn(), onExpenseClick, transactionType: 'expense' as const };
  const { rerender } = render(<SearchResultList {...props} />);
  expect(screen.getByText('1건 · 0원')).toBeInTheDocument();
  const updated = { ...original, amount: -30, memo: '변경된 메모', category: 'custom', aggregateVersion: 2 };
  rerender(<SearchResultList {...props} results={[updated]} />);
  expect(screen.getByText('1건 · -30원')).toBeInTheDocument();
  fireEvent.click(screen.getByText('가게 a'));
  expect(onExpenseClick).toHaveBeenCalledWith(updated);
});

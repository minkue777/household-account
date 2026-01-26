/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useExpenses } from '@/hooks/useExpenses';
import * as expenseService from '@/lib/expenseService';

// expenseService mock
jest.mock('@/lib/expenseService', () => ({
  subscribeToMonthlyExpenses: jest.fn(),
  updateExpense: jest.fn(),
  addManualExpense: jest.fn(),
  deleteExpense: jest.fn(),
  splitExpense: jest.fn(),
  mergeExpenses: jest.fn(),
  unmergeExpense: jest.fn(),
}));

const mockExpenses = [
  {
    id: 'exp1',
    date: '2024-01-15',
    time: '12:00',
    merchant: 'Store A',
    amount: 10000,
    category: 'food',
    cardType: 'main',
    cardLastFour: '1234',
  },
  {
    id: 'exp2',
    date: '2024-01-20',
    time: '13:00',
    merchant: 'Store B',
    amount: 20000,
    category: 'shopping',
    cardType: 'main',
    cardLastFour: '1234',
  },
  {
    id: 'exp3',
    date: '2024-01-15',
    time: '14:00',
    merchant: 'Store C',
    amount: 5000,
    category: 'food',
    cardType: 'main',
    cardLastFour: '5678',
  },
];

describe('useExpenses', () => {
  let mockUnsubscribe: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUnsubscribe = jest.fn();
    (expenseService.subscribeToMonthlyExpenses as jest.Mock).mockImplementation(
      (year, month, callback) => {
        // 즉시 콜백 호출
        setTimeout(() => callback(mockExpenses), 0);
        return mockUnsubscribe;
      }
    );
  });

  describe('initialization', () => {
    it('should start with loading state', () => {
      const { result } = renderHook(() => useExpenses({ year: 2024, month: 1 }));

      expect(result.current.isLoading).toBe(true);
      expect(result.current.expenses).toEqual([]);
    });

    it('should subscribe to monthly expenses', async () => {
      const { result } = renderHook(() => useExpenses({ year: 2024, month: 1 }));

      expect(expenseService.subscribeToMonthlyExpenses).toHaveBeenCalledWith(
        2024,
        1,
        expect.any(Function)
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.expenses).toHaveLength(3);
    });

    it('should unsubscribe on unmount', () => {
      const { unmount } = renderHook(() => useExpenses({ year: 2024, month: 1 }));

      unmount();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });

    it('should resubscribe when year/month changes', () => {
      const { rerender } = renderHook(
        ({ year, month }) => useExpenses({ year, month }),
        { initialProps: { year: 2024, month: 1 } }
      );

      expect(expenseService.subscribeToMonthlyExpenses).toHaveBeenCalledTimes(1);

      rerender({ year: 2024, month: 2 });

      expect(mockUnsubscribe).toHaveBeenCalled();
      expect(expenseService.subscribeToMonthlyExpenses).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateExpense', () => {
    it('should call expenseService.updateExpense', async () => {
      (expenseService.updateExpense as jest.Mock).mockResolvedValue(undefined);

      const { result } = renderHook(() => useExpenses({ year: 2024, month: 1 }));

      await act(async () => {
        await result.current.updateExpense('exp1', { amount: 15000 });
      });

      expect(expenseService.updateExpense).toHaveBeenCalledWith('exp1', { amount: 15000 });
    });
  });

  describe('addExpense', () => {
    it('should call addManualExpense', async () => {
      (expenseService.addManualExpense as jest.Mock).mockResolvedValue('new-expense-id');

      const { result } = renderHook(() => useExpenses({ year: 2024, month: 1 }));

      await act(async () => {
        const id = await result.current.addExpense('New Store', 10000, 'food', '2024-01-25', 'memo');
        expect(id).toBe('new-expense-id');
      });

      expect(expenseService.addManualExpense).toHaveBeenCalledWith(
        'New Store',
        10000,
        'food',
        '2024-01-25',
        'memo'
      );
    });
  });

  describe('deleteExpense', () => {
    it('should call expenseService.deleteExpense', async () => {
      (expenseService.deleteExpense as jest.Mock).mockResolvedValue(undefined);

      const { result } = renderHook(() => useExpenses({ year: 2024, month: 1 }));

      await act(async () => {
        await result.current.deleteExpense('exp1');
      });

      expect(expenseService.deleteExpense).toHaveBeenCalledWith('exp1');
    });
  });

  describe('splitExpense', () => {
    it('should call expenseService.splitExpense', async () => {
      (expenseService.splitExpense as jest.Mock).mockResolvedValue(['split-1', 'split-2']);

      const { result } = renderHook(() => useExpenses({ year: 2024, month: 1 }));

      await waitFor(() => expect(result.current.expenses).toHaveLength(3));

      const splits = [
        { merchant: 'Split A', amount: 5000, category: 'food' },
        { merchant: 'Split B', amount: 5000, category: 'shopping' },
      ];

      await act(async () => {
        const ids = await result.current.splitExpense(result.current.expenses[0], splits);
        expect(ids).toEqual(['split-1', 'split-2']);
      });

      expect(expenseService.splitExpense).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'exp1' }),
        splits
      );
    });
  });

  describe('mergeExpenses', () => {
    it('should call expenseService.mergeExpenses', async () => {
      (expenseService.mergeExpenses as jest.Mock).mockResolvedValue(undefined);

      const { result } = renderHook(() => useExpenses({ year: 2024, month: 1 }));

      await waitFor(() => expect(result.current.expenses).toHaveLength(3));

      await act(async () => {
        await result.current.mergeExpenses(result.current.expenses[0], result.current.expenses[1]);
      });

      expect(expenseService.mergeExpenses).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'exp1' }),
        expect.objectContaining({ id: 'exp2' })
      );
    });
  });

  describe('unmergeExpense', () => {
    it('should call expenseService.unmergeExpense', async () => {
      (expenseService.unmergeExpense as jest.Mock).mockResolvedValue(['unmerged-1', 'unmerged-2']);

      const { result } = renderHook(() => useExpenses({ year: 2024, month: 1 }));

      await waitFor(() => expect(result.current.expenses).toHaveLength(3));

      await act(async () => {
        const ids = await result.current.unmergeExpense(result.current.expenses[0]);
        expect(ids).toEqual(['unmerged-1', 'unmerged-2']);
      });

      expect(expenseService.unmergeExpense).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'exp1' })
      );
    });
  });

  describe('helper functions', () => {
    describe('getExpensesByDate', () => {
      it('should filter expenses by date', async () => {
        const { result } = renderHook(() => useExpenses({ year: 2024, month: 1 }));

        await waitFor(() => expect(result.current.expenses).toHaveLength(3));

        const expenses = result.current.getExpensesByDate('2024-01-15');

        expect(expenses).toHaveLength(2);
        expect(expenses.every(e => e.date === '2024-01-15')).toBe(true);
      });

      it('should return empty array for no matches', async () => {
        const { result } = renderHook(() => useExpenses({ year: 2024, month: 1 }));

        await waitFor(() => expect(result.current.expenses).toHaveLength(3));

        const expenses = result.current.getExpensesByDate('2024-01-01');

        expect(expenses).toHaveLength(0);
      });
    });

    describe('getExpensesByCategory', () => {
      it('should filter expenses by category', async () => {
        const { result } = renderHook(() => useExpenses({ year: 2024, month: 1 }));

        await waitFor(() => expect(result.current.expenses).toHaveLength(3));

        const expenses = result.current.getExpensesByCategory('food');

        expect(expenses).toHaveLength(2);
        expect(expenses.every(e => e.category === 'food')).toBe(true);
      });
    });

    describe('getTotalAmount', () => {
      it('should calculate total amount', async () => {
        const { result } = renderHook(() => useExpenses({ year: 2024, month: 1 }));

        await waitFor(() => expect(result.current.expenses).toHaveLength(3));

        const total = result.current.getTotalAmount();

        expect(total).toBe(35000); // 10000 + 20000 + 5000
      });

      it('should return 0 for no expenses', () => {
        (expenseService.subscribeToMonthlyExpenses as jest.Mock).mockImplementation(
          (year, month, callback) => {
            setTimeout(() => callback([]), 0);
            return mockUnsubscribe;
          }
        );

        const { result } = renderHook(() => useExpenses({ year: 2024, month: 1 }));

        expect(result.current.getTotalAmount()).toBe(0);
      });
    });
  });
});

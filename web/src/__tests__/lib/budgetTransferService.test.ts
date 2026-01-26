import { calculateBudgetAdjustments } from '@/lib/budgetTransferService';
import { BudgetTransfer } from '@/types/budget';

describe('calculateBudgetAdjustments', () => {
  it('should return empty object for empty transfers', () => {
    const result = calculateBudgetAdjustments([]);
    expect(result).toEqual({});
  });

  it('should calculate adjustment for single transfer', () => {
    const transfers: BudgetTransfer[] = [
      {
        id: '1',
        householdId: 'h1',
        yearMonth: '2024-01',
        fromCategory: 'food',
        toCategory: 'transport',
        amount: 10000,
        createdAt: new Date(),
      },
    ];

    const result = calculateBudgetAdjustments(transfers);

    expect(result).toEqual({
      food: -10000, // 예산 감소
      transport: 10000, // 예산 증가
    });
  });

  it('should accumulate multiple transfers to same category', () => {
    const transfers: BudgetTransfer[] = [
      {
        id: '1',
        householdId: 'h1',
        yearMonth: '2024-01',
        fromCategory: 'food',
        toCategory: 'transport',
        amount: 10000,
        createdAt: new Date(),
      },
      {
        id: '2',
        householdId: 'h1',
        yearMonth: '2024-01',
        fromCategory: 'food',
        toCategory: 'entertainment',
        amount: 5000,
        createdAt: new Date(),
      },
    ];

    const result = calculateBudgetAdjustments(transfers);

    expect(result).toEqual({
      food: -15000, // 10000 + 5000 감소
      transport: 10000,
      entertainment: 5000,
    });
  });

  it('should handle bidirectional transfers', () => {
    const transfers: BudgetTransfer[] = [
      {
        id: '1',
        householdId: 'h1',
        yearMonth: '2024-01',
        fromCategory: 'food',
        toCategory: 'transport',
        amount: 10000,
        createdAt: new Date(),
      },
      {
        id: '2',
        householdId: 'h1',
        yearMonth: '2024-01',
        fromCategory: 'transport',
        toCategory: 'food',
        amount: 3000,
        createdAt: new Date(),
      },
    ];

    const result = calculateBudgetAdjustments(transfers);

    expect(result).toEqual({
      food: -10000 + 3000, // -7000
      transport: 10000 - 3000, // 7000
    });
  });

  it('should handle circular transfers (net zero)', () => {
    const transfers: BudgetTransfer[] = [
      {
        id: '1',
        householdId: 'h1',
        yearMonth: '2024-01',
        fromCategory: 'food',
        toCategory: 'transport',
        amount: 10000,
        createdAt: new Date(),
      },
      {
        id: '2',
        householdId: 'h1',
        yearMonth: '2024-01',
        fromCategory: 'transport',
        toCategory: 'food',
        amount: 10000,
        createdAt: new Date(),
      },
    ];

    const result = calculateBudgetAdjustments(transfers);

    expect(result).toEqual({
      food: 0,
      transport: 0,
    });
  });

  it('should handle multiple categories', () => {
    const transfers: BudgetTransfer[] = [
      {
        id: '1',
        householdId: 'h1',
        yearMonth: '2024-01',
        fromCategory: 'food',
        toCategory: 'transport',
        amount: 10000,
        createdAt: new Date(),
      },
      {
        id: '2',
        householdId: 'h1',
        yearMonth: '2024-01',
        fromCategory: 'entertainment',
        toCategory: 'shopping',
        amount: 20000,
        createdAt: new Date(),
      },
      {
        id: '3',
        householdId: 'h1',
        yearMonth: '2024-01',
        fromCategory: 'healthcare',
        toCategory: 'food',
        amount: 5000,
        createdAt: new Date(),
      },
    ];

    const result = calculateBudgetAdjustments(transfers);

    expect(result).toEqual({
      food: -10000 + 5000, // -5000
      transport: 10000,
      entertainment: -20000,
      shopping: 20000,
      healthcare: -5000,
    });
  });
});

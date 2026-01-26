/**
 * @jest-environment jsdom
 */

// Firebase Firestore mock
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  addDoc: jest.fn(),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  doc: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  onSnapshot: jest.fn(),
  Timestamp: {
    now: jest.fn(() => ({ seconds: 1234567890, nanoseconds: 0 })),
  },
  getDocs: jest.fn(),
  runTransaction: jest.fn(),
}));

// Firebase db mock
jest.mock('@/lib/firebase', () => ({
  db: {},
}));

// householdService mock
jest.mock('@/lib/householdService', () => ({
  getStoredHouseholdKey: jest.fn(() => 'test-household-key'),
}));

import {
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  runTransaction,
} from 'firebase/firestore';
import { getStoredHouseholdKey } from '@/lib/householdService';
import {
  addExpense,
  updateExpense,
  deleteExpense,
  updateCategory,
  addManualExpense,
  searchExpenses,
  subscribeToMonthlyExpenses,
  splitExpense,
  mergeExpenses,
  unmergeExpense,
  SplitItem,
} from '@/lib/expenseService';
import { Expense } from '@/types/expense';

describe('expenseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getStoredHouseholdKey as jest.Mock).mockReturnValue('test-household-key');
  });

  describe('addExpense', () => {
    it('should add expense with householdId', async () => {
      const mockDocRef = { id: 'new-expense-id' };
      (addDoc as jest.Mock).mockResolvedValue(mockDocRef);

      const expense = {
        date: '2024-01-15',
        time: '12:30',
        merchant: 'Test Store',
        amount: 10000,
        category: 'food',
        cardType: 'main',
        cardLastFour: '1234',
      };

      const result = await addExpense(expense);

      expect(addDoc).toHaveBeenCalled();
      expect(result).toBe('new-expense-id');
    });

    it('should throw error when no household key', async () => {
      (getStoredHouseholdKey as jest.Mock).mockReturnValue(null);

      const expense = {
        date: '2024-01-15',
        time: '12:30',
        merchant: 'Test Store',
        amount: 10000,
        category: 'food',
        cardType: 'main',
        cardLastFour: '1234',
      };

      await expect(addExpense(expense)).rejects.toThrow('가구 키가 없습니다');
    });
  });

  describe('updateExpense', () => {
    it('should update expense with provided data', async () => {
      (doc as jest.Mock).mockReturnValue({ id: 'expense-id' });
      (updateDoc as jest.Mock).mockResolvedValue(undefined);

      await updateExpense('expense-id', { amount: 20000 });

      expect(doc).toHaveBeenCalledWith(expect.anything(), 'expenses', 'expense-id');
      expect(updateDoc).toHaveBeenCalledWith({ id: 'expense-id' }, { amount: 20000 });
    });
  });

  describe('deleteExpense', () => {
    it('should delete expense by id', async () => {
      (doc as jest.Mock).mockReturnValue({ id: 'expense-id' });
      (deleteDoc as jest.Mock).mockResolvedValue(undefined);

      await deleteExpense('expense-id');

      expect(doc).toHaveBeenCalledWith(expect.anything(), 'expenses', 'expense-id');
      expect(deleteDoc).toHaveBeenCalledWith({ id: 'expense-id' });
    });
  });

  describe('updateCategory', () => {
    it('should update category field', async () => {
      (doc as jest.Mock).mockReturnValue({ id: 'expense-id' });
      (updateDoc as jest.Mock).mockResolvedValue(undefined);

      await updateCategory('expense-id', 'shopping');

      expect(updateDoc).toHaveBeenCalledWith({ id: 'expense-id' }, { category: 'shopping' });
    });
  });

  describe('addManualExpense', () => {
    it('should add manual expense with current time', async () => {
      const mockDocRef = { id: 'manual-expense-id' };
      (addDoc as jest.Mock).mockResolvedValue(mockDocRef);

      const result = await addManualExpense('Manual Store', 5000, 'food', '2024-01-15', 'Test memo');

      expect(addDoc).toHaveBeenCalled();
      const addDocCall = (addDoc as jest.Mock).mock.calls[0][1];
      expect(addDocCall.merchant).toBe('Manual Store');
      expect(addDocCall.amount).toBe(5000);
      expect(addDocCall.category).toBe('food');
      expect(addDocCall.date).toBe('2024-01-15');
      expect(addDocCall.memo).toBe('Test memo');
      expect(addDocCall.cardLastFour).toBe('수동');
      expect(result).toBe('manual-expense-id');
    });

    it('should handle empty memo', async () => {
      const mockDocRef = { id: 'manual-expense-id' };
      (addDoc as jest.Mock).mockResolvedValue(mockDocRef);

      await addManualExpense('Manual Store', 5000, 'food', '2024-01-15');

      const addDocCall = (addDoc as jest.Mock).mock.calls[0][1];
      expect(addDocCall.memo).toBe('');
    });
  });

  describe('searchExpenses', () => {
    it('should return empty array for empty keyword', async () => {
      const result = await searchExpenses('');
      expect(result).toEqual([]);
    });

    it('should return empty array for whitespace keyword', async () => {
      const result = await searchExpenses('   ');
      expect(result).toEqual([]);
    });

    it('should filter by merchant name', async () => {
      const mockDocs = [
        {
          id: 'exp1',
          data: () => ({
            date: '2024-01-15',
            time: '12:00',
            merchant: 'Coffee Shop',
            amount: 5000,
            category: 'food',
          }),
        },
        {
          id: 'exp2',
          data: () => ({
            date: '2024-01-16',
            time: '13:00',
            merchant: 'Bookstore',
            amount: 20000,
            category: 'shopping',
          }),
        },
      ];
      (getDocs as jest.Mock).mockResolvedValue({ docs: mockDocs });

      const result = await searchExpenses('coffee');

      expect(result).toHaveLength(1);
      expect(result[0].merchant).toBe('Coffee Shop');
    });

    it('should filter by memo', async () => {
      const mockDocs = [
        {
          id: 'exp1',
          data: () => ({
            date: '2024-01-15',
            time: '12:00',
            merchant: 'Store A',
            amount: 5000,
            category: 'food',
            memo: 'birthday gift',
          }),
        },
        {
          id: 'exp2',
          data: () => ({
            date: '2024-01-16',
            time: '13:00',
            merchant: 'Store B',
            amount: 20000,
            category: 'shopping',
            memo: 'regular purchase',
          }),
        },
      ];
      (getDocs as jest.Mock).mockResolvedValue({ docs: mockDocs });

      const result = await searchExpenses('birthday');

      expect(result).toHaveLength(1);
      expect(result[0].memo).toBe('birthday gift');
    });

    it('should be case-insensitive', async () => {
      const mockDocs = [
        {
          id: 'exp1',
          data: () => ({
            date: '2024-01-15',
            time: '12:00',
            merchant: 'STARBUCKS',
            amount: 5000,
            category: 'food',
          }),
        },
      ];
      (getDocs as jest.Mock).mockResolvedValue({ docs: mockDocs });

      const result = await searchExpenses('starbucks');

      expect(result).toHaveLength(1);
    });
  });

  describe('subscribeToMonthlyExpenses', () => {
    it('should include expenses within the month', () => {
      const mockCallback = jest.fn();
      const mockUnsubscribe = jest.fn();

      (onSnapshot as jest.Mock).mockImplementation((q, callback) => {
        const mockDocs = [
          {
            id: 'exp1',
            data: () => ({ date: '2024-01-01', time: '00:00', merchant: 'A', amount: 1000, category: 'food' }), // 월 시작
          },
          {
            id: 'exp2',
            data: () => ({ date: '2024-01-15', time: '12:00', merchant: 'B', amount: 2000, category: 'food' }), // 월 중간
          },
          {
            id: 'exp3',
            data: () => ({ date: '2024-01-31', time: '23:59', merchant: 'C', amount: 3000, category: 'food' }), // 월 끝
          },
        ];
        callback({ docs: mockDocs });
        return mockUnsubscribe;
      });

      subscribeToMonthlyExpenses(2024, 1, mockCallback);

      const result = mockCallback.mock.calls[0][0];
      expect(result).toHaveLength(3);
    });

    it('should exclude expenses from other months', () => {
      const mockCallback = jest.fn();
      const mockUnsubscribe = jest.fn();

      (onSnapshot as jest.Mock).mockImplementation((q, callback) => {
        const mockDocs = [
          {
            id: 'exp1',
            data: () => ({ date: '2023-12-31', time: '23:59', merchant: 'A', amount: 1000, category: 'food' }), // 이전 달
          },
          {
            id: 'exp2',
            data: () => ({ date: '2024-01-15', time: '12:00', merchant: 'B', amount: 2000, category: 'food' }), // 해당 월
          },
          {
            id: 'exp3',
            data: () => ({ date: '2024-02-01', time: '00:00', merchant: 'C', amount: 3000, category: 'food' }), // 다음 달
          },
        ];
        callback({ docs: mockDocs });
        return mockUnsubscribe;
      });

      subscribeToMonthlyExpenses(2024, 1, mockCallback);

      const result = mockCallback.mock.calls[0][0];
      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('2024-01-15');
    });

    it('should handle missing category by providing a default', () => {
      const mockCallback = jest.fn();
      const mockUnsubscribe = jest.fn();

      (onSnapshot as jest.Mock).mockImplementation((q, callback) => {
        const mockDocs = [
          {
            id: 'exp1',
            data: () => ({ date: '2024-01-15', time: '12:00', merchant: 'Store', amount: 5000 }), // category 없음
          },
        ];
        callback({ docs: mockDocs });
        return mockUnsubscribe;
      });

      subscribeToMonthlyExpenses(2024, 1, mockCallback);

      const result = mockCallback.mock.calls[0][0];
      // Contract: 카테고리가 없으면 기본값이 제공되어야 함
      expect(result[0].category).toBeDefined();
      expect(typeof result[0].category).toBe('string');
      expect(result[0].category.length).toBeGreaterThan(0);
    });

    it('should normalize category format consistently', () => {
      const mockCallback = jest.fn();
      const mockUnsubscribe = jest.fn();

      (onSnapshot as jest.Mock).mockImplementation((q, callback) => {
        const mockDocs = [
          { id: 'exp1', data: () => ({ date: '2024-01-15', time: '12:00', merchant: 'A', amount: 1000, category: 'FOOD' }) },
          { id: 'exp2', data: () => ({ date: '2024-01-16', time: '12:00', merchant: 'B', amount: 2000, category: 'Food' }) },
          { id: 'exp3', data: () => ({ date: '2024-01-17', time: '12:00', merchant: 'C', amount: 3000, category: 'food' }) },
        ];
        callback({ docs: mockDocs });
        return mockUnsubscribe;
      });

      subscribeToMonthlyExpenses(2024, 1, mockCallback);

      const result = mockCallback.mock.calls[0][0];
      // Contract: 같은 카테고리는 동일한 형식이어야 함
      expect(result[0].category).toBe(result[1].category);
      expect(result[1].category).toBe(result[2].category);
    });

    it('should sort by date with most recent first', () => {
      const mockCallback = jest.fn();
      const mockUnsubscribe = jest.fn();

      (onSnapshot as jest.Mock).mockImplementation((q, callback) => {
        // 무작위 순서로 반환
        const mockDocs = [
          { id: 'exp1', data: () => ({ date: '2024-01-10', time: '12:00', merchant: 'A', amount: 1000, category: 'food' }) },
          { id: 'exp2', data: () => ({ date: '2024-01-20', time: '12:00', merchant: 'B', amount: 2000, category: 'food' }) },
          { id: 'exp3', data: () => ({ date: '2024-01-15', time: '12:00', merchant: 'C', amount: 3000, category: 'food' }) },
        ];
        callback({ docs: mockDocs });
        return mockUnsubscribe;
      });

      subscribeToMonthlyExpenses(2024, 1, mockCallback);

      const result = mockCallback.mock.calls[0][0];
      // Contract: 최신 날짜가 먼저 와야 함
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].date >= result[i + 1].date).toBe(true);
      }
    });
  });

  describe('splitExpense', () => {
    it('should delete original and create new expenses with same date/time', async () => {
      const createdExpenses: any[] = [];
      let deletedId: string | null = null;

      // doc(db, collectionName, docId) 또는 doc(collectionRef) 형태로 호출됨
      (doc as jest.Mock).mockImplementation((...args) => {
        // doc(collectionRef) - 새 문서 생성용
        if (args.length === 1) {
          return { id: `new-${createdExpenses.length}` };
        }
        // doc(db, collectionName, docId) - 기존 문서 참조용
        const docId = args[2]; // 세 번째 인자가 docId
        return { id: docId };
      });

      (runTransaction as jest.Mock).mockImplementation(async (db, callback) => {
        const transaction = {
          delete: jest.fn((ref) => { deletedId = ref.id; }),
          set: jest.fn((ref, data) => { createdExpenses.push({ id: ref.id, ...data }); }),
        };
        return callback(transaction);
      });

      const originalExpense: Expense = {
        id: 'original-id',
        date: '2024-01-15',
        time: '12:00',
        merchant: 'Original Store',
        amount: 30000,
        category: 'food',
        cardType: 'main',
        cardLastFour: '1234',
      };

      const splits: SplitItem[] = [
        { merchant: 'Split Store 1', amount: 10000, category: 'food' },
        { merchant: 'Split Store 2', amount: 20000, category: 'shopping' },
      ];

      await splitExpense(originalExpense, splits);

      // Contract 1: 원본 지출이 삭제되어야 함
      expect(deletedId).toBe('original-id');

      // Contract 2: 분할 수만큼 새 지출이 생성되어야 함
      expect(createdExpenses).toHaveLength(2);

      // Contract 3: 새 지출들은 원본의 날짜/시간을 유지해야 함
      createdExpenses.forEach(expense => {
        expect(expense.date).toBe(originalExpense.date);
        expect(expense.time).toBe(originalExpense.time);
        expect(expense.cardType).toBe(originalExpense.cardType);
        expect(expense.cardLastFour).toBe(originalExpense.cardLastFour);
      });

      // Contract 4: 분할된 지출들은 요청한 금액/가맹점/카테고리를 가져야 함
      expect(createdExpenses[0].amount).toBe(10000);
      expect(createdExpenses[0].merchant).toBe('Split Store 1');
      expect(createdExpenses[0].category).toBe('food');
      expect(createdExpenses[1].amount).toBe(20000);
      expect(createdExpenses[1].merchant).toBe('Split Store 2');
      expect(createdExpenses[1].category).toBe('shopping');
    });

    it('should preserve householdId in split expenses', async () => {
      const createdExpenses: any[] = [];

      (doc as jest.Mock).mockImplementation((...args) => {
        // doc(collectionRef) - 새 문서 생성용
        if (args.length === 1) {
          return { id: `new-${createdExpenses.length}` };
        }
        // doc(db, collectionName, docId)
        const docId = args[2];
        return { id: docId };
      });

      (runTransaction as jest.Mock).mockImplementation(async (db, callback) => {
        const transaction = {
          delete: jest.fn(),
          set: jest.fn((ref, data) => { createdExpenses.push(data); }),
        };
        return callback(transaction);
      });

      const originalExpense: Expense = {
        id: 'original-id',
        date: '2024-01-15',
        time: '12:00',
        merchant: 'Original',
        amount: 20000,
        category: 'food',
        cardType: 'main',
        cardLastFour: '1234',
      };

      await splitExpense(originalExpense, [
        { merchant: 'A', amount: 10000, category: 'food' },
        { merchant: 'B', amount: 10000, category: 'food' },
      ]);

      // Contract: 분할된 지출은 현재 가구에 속해야 함
      createdExpenses.forEach(expense => {
        expect(expense.householdId).toBe('test-household-key');
      });
    });
  });

  describe('mergeExpenses', () => {
    it('should combine amounts and delete source expense', async () => {
      let updatedData: any = null;
      let deletedId: string | null = null;

      (doc as jest.Mock).mockImplementation((db, col, id) => ({ id }));

      (runTransaction as jest.Mock).mockImplementation(async (db, callback) => {
        const transaction = {
          update: jest.fn((ref, data) => { updatedData = { id: ref.id, ...data }; }),
          delete: jest.fn((ref) => { deletedId = ref.id; }),
        };
        return callback(transaction);
      });

      const targetExpense: Expense = {
        id: 'target-id',
        date: '2024-01-15',
        time: '12:00',
        merchant: 'Target Store',
        amount: 10000,
        category: 'food',
        cardType: 'main',
        cardLastFour: '1234',
      };

      const sourceExpense: Expense = {
        id: 'source-id',
        date: '2024-01-15',
        time: '12:30',
        merchant: 'Source Store',
        amount: 5000,
        category: 'shopping',
        cardType: 'main',
        cardLastFour: '1234',
      };

      await mergeExpenses(targetExpense, sourceExpense);

      // Contract 1: 타겟의 금액 = 타겟 금액 + 소스 금액
      expect(updatedData.amount).toBe(15000); // 10000 + 5000

      // Contract 2: 소스 지출이 삭제되어야 함
      expect(deletedId).toBe('source-id');
    });

    it('should store original info in mergedFrom for undo capability', async () => {
      let updatedData: any = null;

      (doc as jest.Mock).mockImplementation((db, col, id) => ({ id }));

      (runTransaction as jest.Mock).mockImplementation(async (db, callback) => {
        const transaction = {
          update: jest.fn((ref, data) => { updatedData = data; }),
          delete: jest.fn(),
        };
        return callback(transaction);
      });

      const targetExpense: Expense = {
        id: 'target-id',
        date: '2024-01-15',
        time: '12:00',
        merchant: 'Target Store',
        amount: 10000,
        category: 'food',
        cardType: 'main',
        cardLastFour: '1234',
      };

      const sourceExpense: Expense = {
        id: 'source-id',
        date: '2024-01-15',
        time: '12:30',
        merchant: 'Source Store',
        amount: 5000,
        category: 'shopping',
        cardType: 'main',
        cardLastFour: '5678',
      };

      await mergeExpenses(targetExpense, sourceExpense);

      // Contract: mergedFrom에 원본 정보가 저장되어 되돌리기가 가능해야 함
      expect(updatedData.mergedFrom).toBeDefined();
      expect(Array.isArray(updatedData.mergedFrom)).toBe(true);

      // 타겟과 소스 정보가 모두 있어야 함
      const merchants = updatedData.mergedFrom.map((m: any) => m.merchant);
      expect(merchants).toContain('Target Store');
      expect(merchants).toContain('Source Store');

      // 각각의 금액이 보존되어야 함
      const amounts = updatedData.mergedFrom.map((m: any) => m.amount);
      expect(amounts).toContain(10000);
      expect(amounts).toContain(5000);
    });

    it('should accumulate mergedFrom when merging already merged expense', async () => {
      let updatedData: any = null;

      (doc as jest.Mock).mockImplementation((db, col, id) => ({ id }));

      (runTransaction as jest.Mock).mockImplementation(async (db, callback) => {
        const transaction = {
          update: jest.fn((ref, data) => { updatedData = data; }),
          delete: jest.fn(),
        };
        return callback(transaction);
      });

      // 이미 합쳐진 지출 (mergedFrom이 있음)
      const targetExpense: Expense = {
        id: 'target-id',
        date: '2024-01-15',
        time: '12:00',
        merchant: 'Target Store',
        amount: 15000,
        category: 'food',
        cardType: 'main',
        cardLastFour: '1234',
        mergedFrom: [
          { merchant: 'Original A', amount: 10000, category: 'food', memo: '' },
          { merchant: 'Original B', amount: 5000, category: 'food', memo: '' },
        ],
      };

      const sourceExpense: Expense = {
        id: 'source-id',
        date: '2024-01-15',
        time: '12:30',
        merchant: 'New Source',
        amount: 3000,
        category: 'shopping',
        cardType: 'main',
        cardLastFour: '5678',
      };

      await mergeExpenses(targetExpense, sourceExpense);

      // Contract: 기존 mergedFrom 정보가 유지되고 새 소스가 추가되어야 함
      expect(updatedData.mergedFrom.length).toBeGreaterThanOrEqual(3);

      const merchants = updatedData.mergedFrom.map((m: any) => m.merchant);
      expect(merchants).toContain('Original A');
      expect(merchants).toContain('Original B');
      expect(merchants).toContain('New Source');
    });
  });

  describe('unmergeExpense', () => {
    it('should do nothing for expense without mergedFrom', async () => {
      const expense: Expense = {
        id: 'expense-id',
        date: '2024-01-15',
        time: '12:00',
        merchant: 'Store',
        amount: 10000,
        category: 'food',
        cardType: 'main',
        cardLastFour: '1234',
      };

      const result = await unmergeExpense(expense);

      // Contract: mergedFrom이 없으면 아무 작업도 하지 않고 빈 배열 반환
      expect(result).toEqual([]);
      expect(runTransaction).not.toHaveBeenCalled();
    });

    it('should restore original expenses and delete merged expense', async () => {
      const createdExpenses: any[] = [];
      let deletedId: string | null = null;

      (doc as jest.Mock).mockImplementation((...args) => {
        // doc(collectionRef) - 새 문서 생성용
        if (args.length === 1) {
          return { id: `restored-${createdExpenses.length}` };
        }
        // doc(db, collectionName, docId)
        const docId = args[2];
        return { id: docId };
      });

      (runTransaction as jest.Mock).mockImplementation(async (db, callback) => {
        const transaction = {
          set: jest.fn((ref, data) => { createdExpenses.push({ id: ref.id, ...data }); }),
          delete: jest.fn((ref) => { deletedId = ref.id; }),
        };
        return callback(transaction);
      });

      const mergedExpense: Expense = {
        id: 'merged-expense-id',
        date: '2024-01-15',
        time: '12:00',
        merchant: 'Merged Store',
        amount: 15000,
        category: 'food',
        cardType: 'main',
        cardLastFour: '1234',
        mergedFrom: [
          { merchant: 'Store A', amount: 10000, category: 'food', memo: 'memo A' },
          { merchant: 'Store B', amount: 5000, category: 'shopping', memo: '' },
        ],
      };

      await unmergeExpense(mergedExpense);

      // Contract 1: 합쳐진 지출이 삭제되어야 함
      expect(deletedId).toBe('merged-expense-id');

      // Contract 2: mergedFrom의 각 항목이 개별 지출로 복원되어야 함
      expect(createdExpenses).toHaveLength(2);

      // Contract 3: 복원된 지출들은 원본 정보를 가져야 함
      const merchantA = createdExpenses.find(e => e.merchant === 'Store A');
      const merchantB = createdExpenses.find(e => e.merchant === 'Store B');

      expect(merchantA).toBeDefined();
      expect(merchantA.amount).toBe(10000);
      expect(merchantA.category).toBe('food');
      expect(merchantA.memo).toBe('memo A');

      expect(merchantB).toBeDefined();
      expect(merchantB.amount).toBe(5000);
      expect(merchantB.category).toBe('shopping');
    });

    it('should preserve date/time/card info from merged expense', async () => {
      const createdExpenses: any[] = [];

      (doc as jest.Mock).mockImplementation((...args) => {
        // doc(collectionRef) - 새 문서 생성용
        if (args.length === 1) {
          return { id: `new-${createdExpenses.length}` };
        }
        // doc(db, collectionName, docId)
        const docId = args[2];
        return { id: docId };
      });

      (runTransaction as jest.Mock).mockImplementation(async (db, callback) => {
        const transaction = {
          set: jest.fn((ref, data) => { createdExpenses.push(data); }),
          delete: jest.fn(),
        };
        return callback(transaction);
      });

      const mergedExpense: Expense = {
        id: 'merged-id',
        date: '2024-01-15',
        time: '14:30',
        merchant: 'Merged',
        amount: 20000,
        category: 'food',
        cardType: 'credit',
        cardLastFour: '9999',
        mergedFrom: [
          { merchant: 'A', amount: 10000, category: 'food', memo: '' },
          { merchant: 'B', amount: 10000, category: 'food', memo: '' },
        ],
      };

      await unmergeExpense(mergedExpense);

      // Contract: 복원된 지출들은 합쳐진 지출의 날짜/시간/카드 정보를 유지해야 함
      createdExpenses.forEach(expense => {
        expect(expense.date).toBe('2024-01-15');
        expect(expense.time).toBe('14:30');
        expect(expense.cardType).toBe('credit');
        expect(expense.cardLastFour).toBe('9999');
      });
    });
  });
});

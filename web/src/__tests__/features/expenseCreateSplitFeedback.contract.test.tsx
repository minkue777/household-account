import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import AddExpenseModal from '@/components/expense/AddExpenseModal';
import ExpenseSplitModal from '@/components/expense/ExpenseSplitModal';
import type { Expense } from '@/types/expense';

const mockShowAlert = jest.fn().mockResolvedValue(undefined);
const mockActiveCategories = [
  {
    id: 'category-food',
    key: 'food',
    label: '식비',
    color: '#ef4444',
    budget: null,
    order: 0,
    isDefault: true,
    isActive: true,
    householdId: 'house-1',
  },
];

jest.mock('@/contexts/CategoryContext', () => ({
  useCategoryContext: () => ({
    activeCategories: mockActiveCategories,
    isLoading: false,
  }),
}));

jest.mock('@/contexts/AppDialogContext', () => ({
  useAppDialog: () => ({ showAlert: mockShowAlert }),
}));

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const expense: Expense = {
  id: 'expense-1',
  aggregateVersion: 1,
  date: '2026-07-27',
  merchant: '테스트 가맹점',
  amount: 10_000,
  category: 'food',
  transactionType: 'expense',
};

describe('거래 생성·분리 mutation feedback 계약', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShowAlert.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('수동 지출 추가는 즉시 닫되 중복 전송을 막고 원격 실패를 앱 알림으로 보여준다', async () => {
    const command = deferred();
    const onAdd = jest.fn(() => command.promise);
    const onClose = jest.fn();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <AddExpenseModal
        isOpen
        onClose={onClose}
        onAdd={onAdd}
        transactionType="expense"
      />
    );

    fireEvent.change(
      screen.getByPlaceholderText('가맹점명을 입력하세요'),
      { target: { value: '테스트 식당' } }
    );
    fireEvent.change(
      screen.getByPlaceholderText('0'),
      { target: { value: '12000' } }
    );

    const addButton = screen.getByRole('button', { name: '추가' });
    fireEvent.click(addButton);
    fireEvent.click(addButton);

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '추가 중...' })).toBeDisabled();

    await act(async () => {
      command.reject(new Error('COMMAND_REJECTED'));
      await command.promise.catch(() => undefined);
    });

    await waitFor(() => {
      expect(mockShowAlert).toHaveBeenCalledWith(
        expect.stringContaining('지출을 저장하지 못했습니다'),
        '지출 추가 실패'
      );
    });
  });

  test('지출 분리는 즉시 닫되 중복 전송을 막고 원격 실패를 앱 알림으로 보여준다', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const command = deferred();
    const onSave = jest.fn(() => command.promise);
    const onClose = jest.fn();

    render(
      <ExpenseSplitModal
        expense={expense}
        isOpen
        onClose={onClose}
        onSave={onSave}
      />
    );

    const splitButton = screen.getByRole('button', { name: '나누기' });
    fireEvent.click(splitButton);
    fireEvent.click(splitButton);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '나누는 중...' })).toBeDisabled();

    await act(async () => {
      command.reject(new Error('COMMAND_REJECTED'));
      await command.promise.catch(() => undefined);
    });

    await waitFor(() => {
      expect(mockShowAlert).toHaveBeenCalledWith(
        expect.stringContaining('지출을 나누지 못했습니다'),
        '지출 분리 실패'
      );
    });
  });
});

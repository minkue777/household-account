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

function splitAmountInputs(): HTMLInputElement[] {
  return screen.getAllByRole('textbox').filter(
    (input) => input.getAttribute('inputmode') === 'numeric'
  ) as HTMLInputElement[];
}

function displayedSplitAmounts(): number[] {
  return splitAmountInputs().map((input) => Number(input.value));
}

function editSplitAmount(index: number, amount: number): void {
  fireEvent.change(splitAmountInputs()[index], { target: { value: String(amount) } });
}

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

  test('두 분할 금액을 번갈아 수정하면 이전에 입력한 칸도 보정 금액을 표시하고 그대로 저장한다', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<ExpenseSplitModal expense={expense} isOpen onClose={jest.fn()} onSave={onSave} />);

    editSplitAmount(0, 1_000);
    expect(displayedSplitAmounts()).toEqual([1_000, 9_000]);
    editSplitAmount(1, 4_000);
    expect(displayedSplitAmounts()).toEqual([6_000, 4_000]);
    editSplitAmount(0, 2_500);
    expect(displayedSplitAmounts()).toEqual([2_500, 7_500]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '나누기' }));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].map((split: { amount: number }) => split.amount))
      .toEqual([2_500, 7_500]);
  });

  test('세 항목에서는 수정한 항목과 마지막 항목만 바뀌고 마지막을 수정하면 바로 앞 항목이 보정된다', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<ExpenseSplitModal expense={expense} isOpen onClose={jest.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: '항목 추가' }));

    editSplitAmount(0, 2_000);
    expect(displayedSplitAmounts()).toEqual([2_000, 5_000, 3_000]);
    editSplitAmount(1, 1_500);
    expect(displayedSplitAmounts()).toEqual([2_000, 1_500, 6_500]);
    editSplitAmount(2, 4_000);
    expect(displayedSplitAmounts()).toEqual([2_000, 4_000, 4_000]);
    expect(screen.getByText('10,000원 / 10,000원')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '나누기' }));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].map((split: { amount: number }) => split.amount))
      .toEqual([2_000, 4_000, 4_000]);
  });

  test('네 항목에서도 앞서 정한 금액을 유지하며 마지막과 바로 앞 항목 사이에서 잔액을 보정한다', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<ExpenseSplitModal expense={expense} isOpen onClose={jest.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: '항목 추가' }));
    fireEvent.click(screen.getByRole('button', { name: '항목 추가' }));

    editSplitAmount(0, 2_000);
    editSplitAmount(1, 1_500);
    editSplitAmount(2, 2_500);
    expect(displayedSplitAmounts()).toEqual([2_000, 1_500, 2_500, 4_000]);
    editSplitAmount(3, 1_000);
    expect(displayedSplitAmounts()).toEqual([2_000, 1_500, 5_500, 1_000]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '나누기' }));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].map((split: { amount: number }) => split.amount))
      .toEqual([2_000, 1_500, 5_500, 1_000]);
  });

  test('금액을 입력한 항목을 삭제하면 남은 마지막 항목이 잔액을 흡수하고 표시와 저장값이 일치한다', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<ExpenseSplitModal expense={expense} isOpen onClose={jest.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: '항목 추가' }));
    fireEvent.click(screen.getByRole('button', { name: '항목 추가' }));
    editSplitAmount(0, 1_000);
    editSplitAmount(1, 2_000);
    editSplitAmount(2, 3_000);
    editSplitAmount(3, 2_500);
    expect(displayedSplitAmounts()).toEqual([1_000, 2_000, 4_500, 2_500]);

    fireEvent.click(screen.getByRole('button', { name: '항목 1 삭제' }));
    expect(displayedSplitAmounts()).toEqual([2_000, 4_500, 3_500]);
    fireEvent.click(screen.getByRole('button', { name: '항목 3 삭제' }));
    expect(displayedSplitAmounts()).toEqual([2_000, 8_000]);
    expect(screen.getByText('10,000원 / 10,000원')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '나누기' }));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].map((split: { amount: number }) => split.amount))
      .toEqual([2_000, 8_000]);
  });

  test('원금을 초과해 입력한 금액은 유지하고 보정 대상만 0으로 만들며 합계 검증으로 저장을 거부한다', () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    render(<ExpenseSplitModal expense={expense} isOpen onClose={onClose} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: '항목 추가' }));

    editSplitAmount(0, 12_000);
    expect(displayedSplitAmounts()).toEqual([12_000, 5_000, 0]);
    expect(screen.getByText('17,000원 / 10,000원')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '나누기' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockShowAlert).toHaveBeenCalledWith(
      '분할 금액의 합(17,000원)이 원래 금액(10,000원)과 일치하지 않습니다.',
      '분할 금액 확인'
    );
  });
});

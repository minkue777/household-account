import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import type { Expense } from '@/types/expense';

const mockShowAlert = jest.fn().mockResolvedValue(undefined);

jest.mock('@/contexts/CategoryContext', () => ({
  useCategoryContext: () => ({
    activeCategories: [
      { key: 'food', label: '식비', color: '#ef4444' },
      { key: 'living', label: '생활', color: '#3b82f6' },
    ],
    isLoading: false,
    getCategoryLabel: (category: string) => category,
  }),
}));

jest.mock('@/contexts/AppDialogContext', () => ({
  useAppDialog: () => ({ showAlert: mockShowAlert }),
}));

import ExpenseEditModal from '@/components/expense/ExpenseEditModal';

const expense: Expense = {
  id: 'expense-1',
  aggregateVersion: 3,
  date: '2026-07-27',
  time: '12:30',
  merchant: '테스트 가맹점',
  amount: 10_000,
  category: 'food',
  transactionType: 'expense',
};

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

function selectRememberedCategory(): void {
  fireEvent.click(screen.getByRole('button', { name: '생활' }));
  fireEvent.click(screen.getByRole('checkbox'));
}

describe('ExpenseEditModal 저장 pipeline 계약', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShowAlert.mockResolvedValue(undefined);
  });

  test('거래 저장을 한 번 시작하고 즉시 닫은 뒤 성공한 경우에만 가맹점 규칙을 저장한다', async () => {
    const transactionSave = deferred();
    const merchantRuleSave = deferred();
    const onSave = jest.fn(() => transactionSave.promise);
    const onSaveMerchantRule = jest.fn(() => merchantRuleSave.promise);
    const onClose = jest.fn();

    render(
      <ExpenseEditModal
        expense={expense}
        isOpen
        onClose={onClose}
        onSave={onSave}
        onSaveMerchantRule={onSaveMerchantRule}
        transactionType="expense"
      />
    );
    selectRememberedCategory();

    const saveButton = screen.getByRole('button', { name: '저장' });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ category: 'living' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSaveMerchantRule).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '저장 중...' })).toBeDisabled();

    await act(async () => {
      transactionSave.resolve();
      await transactionSave.promise;
    });

    await waitFor(() => {
      expect(onSaveMerchantRule).toHaveBeenCalledWith('테스트 가맹점', 'living');
    });

    await act(async () => {
      merchantRuleSave.resolve();
      await merchantRuleSave.promise;
    });
  });

  test('거래 저장 실패 시 가맹점 규칙을 저장하지 않고 AppDialog로 오류를 알린다', async () => {
    const transactionSave = deferred();
    const onSave = jest.fn(() => transactionSave.promise);
    const onSaveMerchantRule = jest.fn();
    const onClose = jest.fn();

    render(
      <ExpenseEditModal
        expense={expense}
        isOpen
        onClose={onClose}
        onSave={onSave}
        onSaveMerchantRule={onSaveMerchantRule}
        transactionType="expense"
      />
    );
    selectRememberedCategory();
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      transactionSave.reject(new Error('VERSION_MISMATCH'));
      await transactionSave.promise.catch(() => undefined);
    });

    await waitFor(() => {
      expect(mockShowAlert).toHaveBeenCalledWith(
        expect.stringContaining('VERSION_MISMATCH'),
        '지출 수정 실패'
      );
    });
    expect(onSaveMerchantRule).not.toHaveBeenCalled();
  });

  test('거래 저장 후 가맹점 규칙만 실패하면 부분 성공 사실을 AppDialog로 알린다', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const onSaveMerchantRule = jest.fn().mockRejectedValue(
      new Error('MERCHANT_RULE_FAILED')
    );
    const onClose = jest.fn();

    render(
      <ExpenseEditModal
        expense={expense}
        isOpen
        onClose={onClose}
        onSave={onSave}
        onSaveMerchantRule={onSaveMerchantRule}
        transactionType="expense"
      />
    );
    selectRememberedCategory();
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => {
      expect(mockShowAlert).toHaveBeenCalledWith(
        expect.stringMatching(/수정은 저장됐지만[\s\S]*MERCHANT_RULE_FAILED/),
        '가맹점 규칙 저장 실패'
      );
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSaveMerchantRule).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('삭제는 즉시 닫고 중복 실행을 막되 원격 실패를 AppDialog로 알린다', async () => {
    const deletion = deferred();
    const onDelete = jest.fn(() => deletion.promise);
    const onClose = jest.fn();

    render(
      <ExpenseEditModal
        expense={expense}
        isOpen
        onClose={onClose}
        onSave={jest.fn()}
        onDelete={onDelete}
        transactionType="expense"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    const deleteButtons = screen.getAllByRole('button', { name: '삭제' });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      deletion.reject(new Error('DELETE_REJECTED'));
      await deletion.promise.catch(() => undefined);
    });

    await waitFor(() => {
      expect(mockShowAlert).toHaveBeenCalledWith(
        expect.stringContaining('DELETE_REJECTED'),
        '지출 삭제 실패'
      );
    });
  });

  test('가구원 알림 전송도 즉시 닫되 원격 실패를 AppDialog로 알린다', async () => {
    const notification = deferred();
    const onNotifyPartner = jest.fn(() => notification.promise);
    const onClose = jest.fn();

    render(
      <ExpenseEditModal
        expense={expense}
        isOpen
        onClose={onClose}
        onSave={jest.fn()}
        onNotifyPartner={onNotifyPartner}
        transactionType="expense"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '알림 보내기' }));

    expect(onNotifyPartner).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      notification.reject(new Error('NOTIFICATION_REJECTED'));
      await notification.promise.catch(() => undefined);
    });

    await waitFor(() => {
      expect(mockShowAlert).toHaveBeenCalledWith(
        expect.stringContaining('NOTIFICATION_REJECTED'),
        '알림 전송 실패'
      );
    });
  });
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useState, type ComponentProps } from 'react';

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

function EditorHarness({
  onClosed = jest.fn(),
  ...props
}: Omit<ComponentProps<typeof ExpenseEditModal>, 'isOpen' | 'onClose'> & { onClosed?: () => void }) {
  const [isOpen, setIsOpen] = useState(true);
  return isOpen ? <ExpenseEditModal {...props} isOpen onClose={() => {
    onClosed();
    setIsOpen(false);
  }} /> : <button onClick={() => setIsOpen(true)}>다시 열기</button>;
}

describe('ExpenseEditModal 저장 pipeline 계약', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShowAlert.mockResolvedValue(undefined);
  });

  test('[MER-005] 거래와 기억 선택을 즉시 한 번 전달하고 성공 후 닫으며 대기 중 중복 저장을 차단한다', async () => {
    const transactionSave = deferred();
    const onSave = jest.fn(() => transactionSave.promise);
    const onClose = jest.fn();

    render(
      <EditorHarness
        expense={expense}
        onClosed={onClose}
        onSave={onSave}
        allowRememberMerchant
        transactionType="expense"
      />
    );
    selectRememberedCategory();

    const saveButton = screen.getByRole('button', { name: '저장' });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ category: 'living' }, true);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '지출 수정' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '저장 중...' })).toBeDisabled();
    expect(screen.getByPlaceholderText('메모를 입력하세요')).toBeDisabled();

    await act(async () => {
      transactionSave.resolve();
      await transactionSave.promise;
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: '지출 수정' })).not.toBeInTheDocument();
  });

  test('거래 저장 실패 시 초안과 기억 선택을 보존하고 같은 입력으로 다시 저장할 수 있다', async () => {
    const transactionSave = deferred();
    const onSave = jest.fn().mockImplementationOnce(() => transactionSave.promise).mockResolvedValue(undefined);
    const onClose = jest.fn();

    render(
      <EditorHarness
        expense={expense}
        onClosed={onClose}
        onSave={onSave}
        allowRememberMerchant
        transactionType="expense"
      />
    );
    selectRememberedCategory();
    fireEvent.change(screen.getByPlaceholderText('메모를 입력하세요'), { target: { value: '남겨야 하는 메모' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(onClose).not.toHaveBeenCalled();

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
    expect(screen.getByRole('dialog', { name: '지출 수정' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('메모를 입력하세요')).toHaveValue('남겨야 하는 메모');
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('button', { name: '저장' })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls).toEqual([
      [{ category: 'living', memo: '남겨야 하는 메모' }, true],
      [{ category: 'living', memo: '남겨야 하는 메모' }, true],
    ]);
    expect(screen.queryByRole('dialog', { name: '지출 수정' })).not.toBeInTheDocument();
  });

  test('저장 중 원장 갱신과 실패 원복이 입력을 지우지 않으며 다시 열면 최신 원본을 사용한다', async () => {
    const transactionSave = deferred();
    const onSave = jest.fn(() => transactionSave.promise);
    const { rerender } = render(<EditorHarness expense={expense} onSave={onSave} transactionType="expense" />);
    fireEvent.change(screen.getByPlaceholderText('메모를 입력하세요'), { target: { value: '작성 중 메모' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    const updatedExpense = { ...expense, memo: '다른 기기의 메모', aggregateVersion: 4 };
    rerender(<EditorHarness expense={updatedExpense} onSave={onSave} transactionType="expense" />);
    expect(screen.getByPlaceholderText('메모를 입력하세요')).toHaveValue('작성 중 메모');
    await act(async () => {
      transactionSave.reject(new Error('VERSION_MISMATCH'));
      await transactionSave.promise.catch(() => undefined);
    });
    expect(screen.getByPlaceholderText('메모를 입력하세요')).toHaveValue('작성 중 메모');
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    fireEvent.click(screen.getByRole('button', { name: '다시 열기' }));
    expect(screen.getByPlaceholderText('메모를 입력하세요')).toHaveValue('다른 기기의 메모');
  });

  test('저장 대기 중 사용자가 닫고 다시 연 편집창은 이전 저장 완료로 닫히지 않는다', async () => {
    const transactionSave = deferred();
    const onClose = jest.fn();
    const onSave = jest.fn(() => transactionSave.promise);
    render(<EditorHarness expense={expense} onClosed={onClose} onSave={onSave} transactionType="expense" />);
    fireEvent.change(screen.getByPlaceholderText('메모를 입력하세요'), { target: { value: '저장할 메모' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(screen.getByRole('button', { name: '닫기' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    fireEvent.click(screen.getByRole('button', { name: '다시 열기' }));
    await act(async () => {
      transactionSave.resolve();
      await transactionSave.promise;
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: '지출 수정' })).toBeInTheDocument();
  });

  test('[MER-005] 기억을 선택하지 않으면 단일 거래 수정만 요청한다', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<ExpenseEditModal expense={expense} isOpen onClose={jest.fn()} onSave={onSave} allowRememberMerchant transactionType="expense" />);
    fireEvent.click(screen.getByRole('button', { name: '생활' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ category: 'living' }, false));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test('삭제는 성공까지 편집창을 유지하고 원격 실패 후 다시 시도할 수 있다', async () => {
    const deletion = deferred();
    const onDelete = jest.fn().mockImplementationOnce(() => deletion.promise).mockResolvedValue(undefined);
    const onClose = jest.fn();

    render(
      <EditorHarness
        expense={expense}
        onClosed={onClose}
        onSave={jest.fn()}
        onDelete={onDelete}
        transactionType="expense"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    const deleteButtons = screen.getAllByRole('button', { name: '삭제' });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

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
    expect(screen.getByRole('dialog', { name: '지출 수정' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    const retryButtons = screen.getAllByRole('button', { name: '삭제' });
    fireEvent.click(retryButtons[retryButtons.length - 1]);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onDelete).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog', { name: '지출 수정' })).not.toBeInTheDocument();
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

  test('월 분할 취소는 원격 명령을 기다리지 않고 모달부터 즉시 닫는다', async () => {
    const cancellation = deferred();
    const onCancelSplitGroup = jest.fn(() => cancellation.promise);
    const onClose = jest.fn();
    const splitExpense: Expense = {
      ...expense,
      id: 'split-expense-1',
      merchant: '테스트 (1/2)',
      splitGroupId: 'split-group-1',
      splitIndex: 1,
      splitTotal: 2,
    };

    render(
      <ExpenseEditModal
        expense={splitExpense}
        isOpen
        onClose={onClose}
        onSave={jest.fn()}
        onCancelSplitGroup={onCancelSplitGroup}
        transactionType="expense"
      />
    );

    const cancelButton = screen.getByRole('button', { name: '분할 취소' });
    fireEvent.click(cancelButton);
    fireEvent.click(cancelButton);

    expect(onCancelSplitGroup).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(
      onCancelSplitGroup.mock.invocationCallOrder[0]
    );

    await act(async () => {
      cancellation.resolve();
      await cancellation.promise;
    });
  });
});

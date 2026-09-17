import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Expense } from '@/types/expense';

const mockUpdateExpense = jest.fn();
const mockDeleteExpense = jest.fn();
const mockShowAlert = jest.fn().mockResolvedValue(undefined);
let mockExpenses: Expense[] = [];
let mockHouseholdKey = 'household-1';

jest.mock('@/lib/expenseService', () => ({
  updateExpense: (...args: unknown[]) => mockUpdateExpense(...args),
  deleteExpense: (...args: unknown[]) => mockDeleteExpense(...args),
}));
jest.mock('@/contexts/AppDialogContext', () => ({
  useAppDialog: () => ({ showAlert: mockShowAlert }),
}));
jest.mock('@/contexts/HouseholdContext', () => ({
  useHousehold: () => ({ householdKey: mockHouseholdKey, isSessionVerified: true }),
}));
jest.mock('@/contexts/CategoryContext', () => ({
  useCategoryContext: () => ({
    isLoading: false, serverSnapshotReady: true, readError: null,
    activeCategories: [{ key: 'food', label: '식비', color: '#ef4444' }],
    getCategoryLabel: () => '식비', getCategoryColor: () => '#ef4444',
  }),
}));
jest.mock('@/contexts/LedgerReadModelContext', () => ({
  useLedgerReadModel: () => ({
    expenses: mockExpenses, isLoading: false, serverSnapshotReady: true, readError: null,
    localCurrencyBalance: null, localCurrencySettled: true, localCurrencyReady: true,
    readRefreshKey: 'read-1', prefetchAdjacentPeriods: jest.fn(),
  }),
}));
jest.mock('@/features/home-preferences/homePreferences', () => ({
  useHomePreferences: () => ({ configuration: { leftCard: 'monthlySpent', rightCard: 'monthlyRemainingBudget' } }),
}));
jest.mock('@/features/ledger/useLedgerYearSummary', () => ({
  useLedgerYearSummary: () => ({ expenses: [], total: null, error: null }),
}));
jest.mock('@/features/ledger/useLedgerHomeReadiness', () => ({ useLedgerHomeReadiness: jest.fn() }));
jest.mock('@/features/ledger/useLedgerEditLink', () => ({ useLedgerEditLink: jest.fn() }));

// Keep the real LedgerPage date filtering, detail ownership and edit form.
// Unrelated home cards and navigation rendering are outside this save boundary.
jest.mock('@/components/Calendar', () => ({
  __esModule: true,
  default: ({ onDateClick }: { onDateClick: (date: string) => void }) => <>
    <button onClick={() => onDateClick('2026-09-17')}>17일</button>
    <button onClick={() => onDateClick('2026-09-18')}>18일</button>
  </>,
}));
jest.mock('@/components/CategorySummary', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/BalanceCards', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/HomeHeader', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/CategoryDetailModal', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/LocalCurrencyModal', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/expense/AddExpenseModal', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/expense/IncomeSummaryModal', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/search/SearchModal', () => ({ __esModule: true, default: () => null }));

import LedgerPage from '@/components/home/LedgerPage';

const original: Expense = {
  id: 'expense-1', aggregateVersion: 7, date: '2026-09-17', time: '12:30',
  merchant: '하나뿐인 거래', amount: 10_000, category: 'food', transactionType: 'expense',
};

function deferred() {
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; });
  return { promise, reject };
}

function openEditor() {
  const view = render(<LedgerPage transactionType="expense" />);
  fireEvent.click(screen.getByRole('button', { name: '17일' }));
  fireEvent.click(screen.getByText(original.merchant));
  return view;
}

describe('홈 원장 편집의 낙관적 목록 변경과 초안 수명', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExpenses = [original];
    mockHouseholdKey = 'household-1';
    mockShowAlert.mockResolvedValue(undefined);
  });

  test('날짜 변경으로 선택 날짜가 비어도 저장 실패 후 날짜·메모를 보존하고 그대로 재시도한다', async () => {
    const save = deferred();
    mockUpdateExpense.mockImplementationOnce(() => save.promise).mockResolvedValue(undefined);
    const view = openEditor();
    fireEvent.change(screen.getByPlaceholderText('메모를 입력하세요'), { target: { value: '보존할 메모' } });
    const dateInput = screen.getByRole('dialog').querySelector('input[type="date"]')!;
    fireEvent.change(dateInput, { target: { value: '2026-09-18' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(mockUpdateExpense).toHaveBeenCalledTimes(1));

    mockExpenses = [{ ...original, date: '2026-09-18', memo: '보존할 메모' }];
    view.rerender(<LedgerPage transactionType="expense" />);
    expect(screen.getByText('지출 내역이 없습니다')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '지출 수정' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('메모를 입력하세요')).toHaveValue('보존할 메모');
    expect(dateInput).toHaveValue('2026-09-18');
    expect(screen.getByRole('button', { name: '저장 중...' })).toBeDisabled();

    mockExpenses = [original];
    view.rerender(<LedgerPage transactionType="expense" />);
    await act(async () => {
      save.reject(new Error('SAVE_REJECTED'));
      await save.promise.catch(() => undefined);
    });
    expect(mockShowAlert).toHaveBeenCalledWith(expect.stringContaining('SAVE_REJECTED'), '지출 수정 실패');
    expect(screen.getByPlaceholderText('메모를 입력하세요')).toHaveValue('보존할 메모');
    expect(dateInput).toHaveValue('2026-09-18');
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '지출 수정' })).not.toBeInTheDocument());
    expect(mockUpdateExpense.mock.calls).toEqual([
      [original.id, { memo: '보존할 메모', date: '2026-09-18' }, 7, false],
      [original.id, { memo: '보존할 메모', date: '2026-09-18' }, 7, false],
    ]);
  });

  test('마지막 거래의 낙관적 삭제에도 편집창을 유지하고 삭제 실패 후 초안과 버전을 보존한다', async () => {
    const deletion = deferred();
    mockDeleteExpense.mockImplementationOnce(() => deletion.promise).mockResolvedValue(undefined);
    const view = openEditor();
    fireEvent.change(screen.getByPlaceholderText('메모를 입력하세요'), { target: { value: '삭제 전에 작성한 메모' } });
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    let deleteButtons = screen.getAllByRole('button', { name: '삭제' });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    await waitFor(() => expect(mockDeleteExpense).toHaveBeenCalledWith(original.id, 7));

    mockExpenses = [];
    view.rerender(<LedgerPage transactionType="expense" />);
    expect(screen.getByText('지출 내역이 없습니다')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '지출 수정' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('메모를 입력하세요')).toHaveValue('삭제 전에 작성한 메모');

    mockExpenses = [original];
    view.rerender(<LedgerPage transactionType="expense" />);
    await act(async () => {
      deletion.reject(new Error('DELETE_REJECTED'));
      await deletion.promise.catch(() => undefined);
    });
    expect(mockShowAlert).toHaveBeenCalledWith(expect.stringContaining('DELETE_REJECTED'), '지출 삭제 실패');
    expect(screen.getByPlaceholderText('메모를 입력하세요')).toHaveValue('삭제 전에 작성한 메모');
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    deleteButtons = screen.getAllByRole('button', { name: '삭제' });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '지출 수정' })).not.toBeInTheDocument());
    expect(mockDeleteExpense.mock.calls).toEqual([[original.id, 7], [original.id, 7]]);
  });

  test('사용자가 다른 날짜로 이동하면 기존 선택 거래와 편집창을 남기지 않는다', () => {
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: '18일' }));
    expect(screen.queryByRole('dialog', { name: '지출 수정' })).not.toBeInTheDocument();
    expect(screen.getByText('지출 내역이 없습니다')).toBeInTheDocument();
  });

  test('가구가 바뀌면 같은 날짜와 거래 ID가 있어도 이전 가구의 편집 초안을 폐기한다', () => {
    const view = openEditor();
    fireEvent.change(screen.getByPlaceholderText('메모를 입력하세요'), { target: { value: '이전 가구 초안' } });
    mockHouseholdKey = 'household-2';
    mockExpenses = [{ ...original, merchant: '새 가구의 거래' }];
    view.rerender(<LedgerPage transactionType="expense" />);
    expect(screen.queryByRole('dialog', { name: '지출 수정' })).not.toBeInTheDocument();
    expect(screen.getByText('새 가구의 거래')).toBeInTheDocument();
  });
});

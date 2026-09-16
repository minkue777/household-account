import { act, renderHook, waitFor } from '@testing-library/react';
import type { Expense } from '@/types/expense';
import { useLedgerYearSummary } from '@/features/ledger/useLedgerYearSummary';
import { useLedgerEditLink } from '@/features/ledger/useLedgerEditLink';

const mockSubscribe = jest.fn();
const mockGetExpense = jest.fn();
let mockParams = new URLSearchParams();
const mockRouter = { replace: jest.fn(() => { mockParams = new URLSearchParams(); }) };
jest.mock('next/navigation', () => ({
  usePathname: () => '/', useRouter: () => mockRouter, useSearchParams: () => mockParams,
}));
jest.mock('@/lib/expenseService', () => ({
  subscribeToDateRangeExpenses: (...args: unknown[]) => mockSubscribe(...args),
  getExpenseForEdit: (...args: unknown[]) => mockGetExpense(...args),
}));

const expense: Expense = { id: 'target', aggregateVersion: 1, transactionType: 'expense',
  merchant: '상점', amount: 31000, category: 'food', date: '2026-08-12' };

beforeEach(() => {
  jest.clearAllMocks();
  mockSubscribe.mockReset().mockImplementation(() => jest.fn());
  mockGetExpense.mockReset();
  mockParams = new URLSearchParams();
});

describe('메인 화면의 독립적인 연간 구독', () => {
  const base = { year: 2026, householdKey: 'house-a', transactionType: 'expense' as const,
    enabled: false, ready: false, readRefreshKey: '1' };

  it('연간 카드가 필요하고 월 원장이 준비된 경우에만 조회하며 0원과 실패를 구분한다', async () => {
    const view = renderHook(props => useLedgerYearSummary(props), { initialProps: base });
    view.rerender({ ...base, enabled: true });
    await act(async () => {});
    expect(mockSubscribe).not.toHaveBeenCalled();
    view.rerender({ ...base, enabled: true, ready: true });
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledTimes(1));
    expect(view.result.current.total).toBeNull();
    act(() => mockSubscribe.mock.calls[0][2]([]));
    expect(view.result.current.total).toBe(0);
    act(() => mockSubscribe.mock.calls[0][2]([expense]));
    act(() => mockSubscribe.mock.calls[0][3].onError(new Error('offline')));
    expect(view.result.current).toMatchObject({ total: 31000, error: true });
  });

  it('연도·가구 전환은 이전 구독과 값만 폐기하고 늦은 결과가 새 범위를 덮지 못한다', async () => {
    const props = { ...base, enabled: true, ready: true };
    const view = renderHook(input => useLedgerYearSummary(input), { initialProps: props });
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledTimes(1));
    const oldCallback = mockSubscribe.mock.calls[0][2];
    const oldStop = mockSubscribe.mock.results[0].value;
    act(() => oldCallback([expense]));
    view.rerender({ ...props, householdKey: 'house-b', year: 2025 });
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledTimes(2));
    expect(oldStop).toHaveBeenCalledTimes(1);
    act(() => oldCallback([expense]));
    expect(view.result.current).toMatchObject({ expenses: [], total: null, error: false });
    expect(mockSubscribe.mock.calls[1].slice(0, 2)).toEqual(['2025-01-01', '2025-12-31']);
    view.unmount();
    expect(mockSubscribe.mock.results[1].value).toHaveBeenCalledTimes(1);
  });
});

describe('편집 링크와 원장 목록의 독립성', () => {
  const base = { householdKey: 'house-a', transactionType: 'expense' as const, ready: true, expenses: [] as Expense[] };

  it('메모리에 있는 거래는 단건 서버 조회 없이 연다', async () => {
    mockParams = new URLSearchParams('edit=target');
    const openExpense = jest.fn();
    renderHook(() => useLedgerEditLink({ ...base, expenses: [expense], openExpense }));
    await waitFor(() => expect(openExpense).toHaveBeenCalledWith(expense));
    expect(mockGetExpense).not.toHaveBeenCalled();
  });

  it('다른 거래의 갱신이 진행 중인 편집 조회를 다시 시작하지 않는다', async () => {
    let finish!: (value: Expense) => void;
    mockGetExpense.mockImplementation(() => new Promise<Expense>(resolve => { finish = resolve; }));
    mockParams = new URLSearchParams('edit=target');
    const openExpense = jest.fn();
    const view = renderHook(props => useLedgerEditLink({ ...props, openExpense }), { initialProps: base });
    await waitFor(() => expect(mockGetExpense).toHaveBeenCalledTimes(1));
    view.rerender({ ...base, expenses: [{ ...expense, id: 'unrelated' }] });
    await act(async () => {});
    expect(mockGetExpense).toHaveBeenCalledTimes(1);
    await act(async () => finish(expense));
    expect(openExpense).toHaveBeenCalledTimes(1);
    expect(openExpense).toHaveBeenCalledWith(expense);
  });

  it('다른 가구로 이동한 뒤 완료된 예전 편집 조회는 화면을 이동시키지 않는다', async () => {
    let finishOld!: (value: Expense) => void;
    mockGetExpense.mockImplementationOnce(() => new Promise<Expense>(resolve => { finishOld = resolve; }))
      .mockResolvedValueOnce(null);
    mockParams = new URLSearchParams('edit=target');
    const openExpense = jest.fn();
    const view = renderHook(props => useLedgerEditLink({ ...props, openExpense }), { initialProps: base });
    await waitFor(() => expect(mockGetExpense).toHaveBeenCalledTimes(1));
    view.rerender({ ...base, householdKey: 'house-b' });
    await waitFor(() => expect(mockGetExpense).toHaveBeenCalledTimes(2));
    await act(async () => finishOld(expense));
    expect(openExpense).not.toHaveBeenCalled();
    expect(view.result.current).toBe('지출을 찾을 수 없습니다.');
  });
});

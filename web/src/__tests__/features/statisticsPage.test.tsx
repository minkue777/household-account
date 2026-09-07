import { Profiler } from 'react';
import { getClientSessionScope, setClientSessionScope } from '@/composition/clientSessionScope';
import { notifyExpenseStatisticsMutation } from '@/platform/reporting/expenseStatisticsInvalidation';
import { resolveExpenseStatisticsPeriod } from '@/features/reporting/statisticsPeriod';
import { resetLoadedClientSessionState } from '@/composition/clientSessionResetRegistry';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import StatsPage from '@/app/stats/page';
import { readExpenseStatistics } from '@/platform/reporting/expenseStatisticsReadModel';
import { deleteExpense, updateExpense } from '@/lib/expenseService';
import { ledgerCommands } from '@/features/ledger/application/ledgerCommands';
import type { LedgerTransactionCommandResult } from '@/platform/functions-api/householdCommandContract';
import type { Expense } from '@/types/expense';
import type { CategoryDocument } from '@/types/category';

let mockHousehold = { householdKey: 'house-1', remoteReadEpoch: 0 };
let mockCurrentMemberId = 'member';
let mockCategories: CategoryDocument[] = [];
const mockShowAlert = jest.fn();
const mockExecuteLedger = jest.fn();
jest.mock('@/composition/webCommandRuntime', () => ({ getHouseholdCommandClient: () => ({ execute: mockExecuteLedger }) }));
jest.mock('@/contexts/HouseholdContext', () => ({ useHousehold: () => ({ ...mockHousehold, currentMember: { id: mockCurrentMemberId } }) }));
jest.mock('@/contexts/AppDialogContext', () => ({ useAppDialog: () => ({ showAlert: mockShowAlert }) }));
jest.mock('@/contexts/CategoryContext', () => ({ useCategoryContext: () => ({
  activeCategories: mockCategories,
  getCategoryLabel: (key: string) => mockCategories.find(category => category.key === key)?.label ?? key,
  getCategoryColor: () => '#000000',
  isLoading: false,
}) }));
jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ themeConfig: { titleGradient: '' } }) }));
jest.mock('@/platform/reporting/expenseStatisticsReadModel', () => ({ readExpenseStatistics: jest.fn() }));
jest.mock('@/lib/expenseService', () => ({ updateExpense: jest.fn(), deleteExpense: jest.fn() }));
// Actual chart controls, category detail, edit form and confirmation dialog are exercised.
// Only the canvas renderer and chart click hit testing are replaced.
jest.mock('react-chartjs-2', () => ({ Line: ({ data }: { data: { datasets: Array<{ label: string }> } }) => <output data-testid="trend-series">{data.datasets.map(dataset => dataset.label).join(',')}</output> }));
jest.mock('@/components/DonutChart', () => ({ __esModule: true, default: ({ expenses, onCategoryClick }: { expenses: Expense[]; onCategoryClick: (key: string) => void }) => <><button onClick={() => onCategoryClick(expenses[0]?.category ?? 'food')}>상세</button><output data-testid="donut-source">{expenses.map(expense => `${expense.category}:${expense.amount}`).join(',')}</output></> }));
const read = jest.mocked(readExpenseStatistics);
const row: Expense = { id: 'a', aggregateVersion: 1, amount: 0, date: '2026-09-01', merchant: '가게', category: 'food', transactionType: 'expense' };
const category = (key: string, budget: number | null, order = 0): CategoryDocument => ({
  id: key, key, label: key, color: '#123456', budget, order, isDefault: false, isActive: true, householdId: 'house-1',
});
async function confirmMutation() {
  notifyExpenseStatisticsMutation(getClientSessionScope(), mockHousehold.householdKey);
}
beforeEach(() => {
  jest.clearAllMocks();
  read.mockReset();
  setClientSessionScope({ principalUid: 'uid', memberId: 'member', householdId: 'house-1', sessionGeneration: 1 });
  resetLoadedClientSessionState();
  mockHousehold = { householdKey: 'house-1', remoteReadEpoch: 0 };
  mockCurrentMemberId = 'member';
  mockCategories = [];
  read.mockResolvedValue([]);
  mockShowAlert.mockResolvedValue(undefined);
  mockExecuteLedger.mockReset();
  jest.mocked(updateExpense).mockReset().mockImplementation(confirmMutation);
  jest.mocked(deleteExpense).mockReset().mockImplementation(confirmMutation);
});
afterEach(() => jest.useRealTimers());

async function openEditor() {
  fireEvent.click(await screen.findByText('상세'));
  fireEvent.click(screen.getByText('가게'));
  return screen.getByRole('dialog', { name: '지출 수정' });
}

it('distinguishes observed zero, NoData and source failure and advances revision only after a successful command', async () => {
  mockCategories = [category('food', 500), category('living', null)];
  read.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ ...row, amount: 20 }]);
  jest.mocked(updateExpense).mockImplementation(confirmMutation);
  render(<StatsPage />);
  await screen.findByText('0원');
  const editor = await openEditor();
  fireEvent.change(within(editor).getByDisplayValue('0'), { target: { value: '20' } });
  fireEvent.click(within(editor).getByRole('button', { name: 'li' }));
  fireEvent.click(within(editor).getByRole('checkbox'));
  fireEvent.click(within(editor).getByRole('button', { name: '저장' }));
  await screen.findByText('20원');
  expect(updateExpense).toHaveBeenCalledWith('a', { amount: 20, category: 'living' }, 1, true);
  expect(read).toHaveBeenCalledTimes(2);
  read.mockRejectedValueOnce(new Error('offline'));
  fireEvent.focus(window);
  await screen.findByRole('alert');
  expect(screen.queryByText('0원')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  await screen.findByText('데이터 없음');
});

it.each(['delete', 'save'] as const)('STAT-004 actual %s failure preserves the period, category detail and unsaved draft until retry succeeds', async command => {
  read.mockResolvedValue([{ ...row, amount: 10 }]);
  let rejectCommand!: (error: Error) => void;
  const commandMock = command === 'delete' ? jest.mocked(deleteExpense) : jest.mocked(updateExpense);
  commandMock.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectCommand = reject; }));
  commandMock.mockImplementationOnce(confirmMutation);
  render(<StatsPage />);
  fireEvent.click(screen.getByRole('button', { name: '3개월' }));
  const editor = await openEditor();
  fireEvent.change(within(editor).getByPlaceholderText('메모를 입력하세요'), { target: { value: '실패해도 보존할 메모' } });
  fireEvent.change(within(editor).getByDisplayValue('10'), { target: { value: '27' } });
  const submit = () => {
    if (command === 'delete') {
      fireEvent.click(within(editor).getByRole('button', { name: '삭제' }));
      fireEvent.click(within(screen.getByRole('dialog', { name: '지출 삭제' })).getByRole('button', { name: '삭제' }));
    } else {
      fireEvent.click(within(editor).getByRole('button', { name: '저장' }));
    }
  };
  const initialReadCount = read.mock.calls.length;
  const selectedRange = resolveExpenseStatisticsPeriod('3months', '', '');
  submit();
  expect(editor).toBeInTheDocument();
  expect(within(editor).getByDisplayValue('실패해도 보존할 메모')).toBeInTheDocument();
  expect(read).toHaveBeenCalledTimes(initialReadCount);
  await act(async () => rejectCommand(new Error('permission-denied')));
  await waitFor(() => expect(mockShowAlert).toHaveBeenCalledWith(expect.stringContaining('permission-denied'), expect.stringContaining('실패')));
  expect(screen.getByRole('dialog', { name: '지출 수정' })).toBe(editor);
  expect(within(editor).getByDisplayValue('27')).toBeInTheDocument();
  expect(within(editor).getByDisplayValue('실패해도 보존할 메모')).toBeInTheDocument();
  expect(screen.getByText('1건 · 10원')).toBeInTheDocument();
  expect(read).toHaveBeenCalledTimes(initialReadCount);
  submit();
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '지출 수정' })).not.toBeInTheDocument());
  await waitFor(() => expect(read).toHaveBeenCalledTimes(initialReadCount + 1));
  expect(read.mock.calls.at(-1)?.slice(0, 2)).toEqual([selectedRange.startDate, selectedRange.endDate]);
  if (command === 'delete') expect(deleteExpense).toHaveBeenLastCalledWith('a', 1);
  else expect(updateExpense).toHaveBeenLastCalledWith('a', { amount: 27, memo: '실패해도 보존할 메모' }, 1, false);
});

it.each(['save', 'delete'] as const)('a completed shared refresh is not repeated when the %s form finishes closing', async command => {
  read.mockResolvedValue([{ ...row, amount: 10 }]);
  let finishForm!: () => void;
  const commandMock = command === 'delete' ? jest.mocked(deleteExpense) : jest.mocked(updateExpense);
  commandMock.mockImplementationOnce(() => new Promise<void>(resolve => { finishForm = resolve; }));
  render(<StatsPage />);
  const editor = await openEditor();
  if (command === 'save') {
    fireEvent.change(within(editor).getByDisplayValue('10'), { target: { value: '27' } });
    fireEvent.click(within(editor).getByRole('button', { name: '저장' }));
  } else {
    fireEvent.click(within(editor).getByRole('button', { name: '삭제' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '지출 삭제' })).getByRole('button', { name: '삭제' }));
  }
  expect(read).toHaveBeenCalledTimes(1);
  read.mockResolvedValue(command === 'save' ? [{ ...row, aggregateVersion: 2, amount: 27 }] : []);
  // The command layer publishes its revision before its caller finishes the
  // optimistic projection and closes the form. Let that shared read finish first.
  await act(confirmMutation);
  await screen.findAllByText(command === 'save' ? '27원' : '데이터 없음');
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => finishForm());
  expect(screen.queryByRole('dialog', { name: '지출 수정' })).not.toBeInTheDocument();
  expect(read).toHaveBeenCalledTimes(2);
  fireEvent.focus(window);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
});

it.each(['memo', 'category'] as const)('confirmed %s edits update the visible statistics and next editor without another source read', async field => {
  mockCategories = [category('food', 500), category('living', 500)];
  read.mockResolvedValue([{ ...row, amount: 10, memo: '원래 메모' }]);
  const confirmed: LedgerTransactionCommandResult = {
    transactionId: row.id, householdId: 'house-1', transactionType: 'expense',
    merchant: row.merchant, amountInWon: 10, accountingDate: row.date,
    memo: field === 'memo' ? '새 메모' : '원래 메모',
    categoryId: field === 'category' ? 'living' : 'food',
    aggregateVersion: 2, lifecycleState: 'active', localTime: '12:00',
    cardType: 'manual', cardDisplay: '수동', creatorMemberId: 'member',
  };
  mockExecuteLedger.mockResolvedValue(confirmed);
  jest.mocked(updateExpense).mockImplementation(async (id, changes, version, remember) => {
    await ledgerCommands.update('house-1', id, version, changes, remember);
  });
  render(<StatsPage />);
  const editor = await openEditor();
  if (field === 'memo') {
    fireEvent.change(within(editor).getByPlaceholderText('메모를 입력하세요'), { target: { value: '새 메모' } });
  } else {
    fireEvent.click(within(editor).getByRole('button', { name: 'li' }));
  }
  fireEvent.click(within(editor).getByRole('button', { name: '저장' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '지출 수정' })).not.toBeInTheDocument());
  expect(read).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('donut-source')).toHaveTextContent(`${confirmed.categoryId}:10`);
  const nextEditor = await openEditor();
  expect(within(nextEditor).getByDisplayValue(confirmed.memo)).toBeInTheDocument();
  fireEvent.change(within(nextEditor).getByPlaceholderText('메모를 입력하세요'), { target: { value: '다음 수정' } });
  mockExecuteLedger.mockResolvedValue({ ...confirmed, memo: '다음 수정', aggregateVersion: 3 });
  fireEvent.click(within(nextEditor).getByRole('button', { name: '저장' }));
  await waitFor(() => expect(updateExpense).toHaveBeenLastCalledWith('a', { memo: '다음 수정' }, 2, false));
  expect(read).toHaveBeenCalledTimes(1);
  fireEvent.focus(window);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
});

it('STAT-003 waits for the asynchronous budget catalog, keeps screen toggles across period changes, and reinitializes on household change', async () => {
  read.mockResolvedValue([{ ...row, amount: 10 }]);
  const { rerender } = render(<StatsPage />);
  await screen.findByText('10원');
  expect(screen.queryByTestId('trend-series')).not.toBeInTheDocument();
  mockCategories = [category('childcare', 0, 0), category('food', 500, 1), category('living', null, 2)];
  rerender(<StatsPage />);
  expect(await screen.findByTestId('trend-series')).toHaveTextContent('childcare,food');
  expect(screen.getByRole('button', { name: 'childcare' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'living' })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'food' }));
  fireEvent.click(screen.getByRole('button', { name: '3개월' }));
  await waitFor(() => expect(screen.getByTestId('trend-series')).toHaveTextContent(/^childcare$/));
  mockCategories = [category('childcare', 0), category('food', 500)];
  rerender(<StatsPage />);
  expect(screen.getByTestId('trend-series')).toHaveTextContent(/^childcare$/);
  setClientSessionScope({ principalUid: 'uid', memberId: 'member', householdId: 'house-2', sessionGeneration: 2 });
  mockHousehold = { householdKey: 'house-2', remoteReadEpoch: 1 };
  mockCategories = [];
  rerender(<StatsPage />);
  await screen.findByText('10원');
  mockCategories = [category('living', null), category('custom', null)];
  rerender(<StatsPage />);
  await waitFor(() => expect(screen.getByTestId('trend-series')).toHaveTextContent(/^living$/));
  expect(screen.getByRole('button', { name: 'custom' })).toHaveAttribute('aria-pressed', 'false');
});

it('STAT-001 actual period selector uses Seoul month bounds and incomplete custom input falls back to one year', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-08-31T15:00:00Z'));
  render(<StatsPage />);
  await screen.findByText('데이터 없음');
  expect(read.mock.calls.at(-1)?.slice(0, 2)).toEqual(['2025-10-01', '2026-09-30']);
  fireEvent.click(screen.getByRole('button', { name: '3개월' }));
  expect(screen.getByText('2026.7 - 2026.9')).toBeInTheDocument();
  expect(screen.queryByText('???...')).not.toBeInTheDocument();
  expect(read).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '6개월' }));
  expect(screen.getByText('2026.4 - 2026.9')).toBeInTheDocument();
  expect(read).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '직접 선택' }));
  fireEvent.change(screen.getByLabelText('시작 월'), { target: { value: '2026-02' } });
  expect(screen.getByText('2025.10 - 2026.9')).toBeInTheDocument();
  expect(read).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('종료 월'), { target: { value: '2026-03' } });
  expect(screen.getByText('2026.2 - 2026.3')).toBeInTheDocument();
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => {});
});

it('discards previous household response and rejects a reversed period before reading', async () => {
  let resolve!: (rows: Expense[]) => void;
  read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const { rerender } = render(<StatsPage />);
  setClientSessionScope({ principalUid: 'uid', memberId: 'member', householdId: 'house-2', sessionGeneration: 2 });
  mockHousehold = { householdKey: 'house-2', remoteReadEpoch: 1 }; rerender(<StatsPage />);
  await screen.findByText('데이터 없음');
  await act(async () => resolve([{ ...row, amount: 777 }]));
  expect(screen.queryByText('777원')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '직접 선택' }));
  fireEvent.change(screen.getByLabelText('시작 월'), { target: { value: '2026-09' } });
  const before = read.mock.calls.length;
  fireEvent.change(screen.getByLabelText('종료 월'), { target: { value: '2026-08' } });
  await screen.findByText('시작 월은 종료 월보다 늦을 수 없습니다.');
  expect(read).toHaveBeenCalledTimes(before);
});

it('commits cached period totals immediately, without a loading frame or another source request', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-07T12:00:00Z'));
  read.mockResolvedValue([{ ...row, id: 'winter', date: '2026-02-01', amount: 100 }, { ...row, amount: 20 }]);
  const frames: string[] = [];
  render(<Profiler id="statistics" onRender={() => frames.push(document.body.textContent ?? '')}><StatsPage /></Profiler>);
  await screen.findByText('120원');
  frames.length = 0;
  fireEvent.click(screen.getByRole('button', { name: '3개월' }));
  expect(frames[0]).toContain('20원');
  expect(frames.every(frame => !frame.includes('로딩중...') && !frame.includes('120원'))).toBe(true);
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: '6개월' }));
  expect(screen.getByText('20원')).toBeInTheDocument();
  await act(async () => {});
  expect(read).toHaveBeenCalledTimes(1);
});

it('shows completed session data on the first re-entry commit while the new server verification is pending', async () => {
  read.mockResolvedValueOnce([{ ...row, amount: 123 }]);
  const first = render(<StatsPage />);
  await screen.findByText('123원');
  first.unmount();
  let finish!: (rows: Expense[]) => void;
  read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const frames: string[] = [];
  render(<Profiler id="reentry" onRender={() => frames.push(document.body.textContent ?? '')}><StatsPage /></Profiler>);
  expect(frames[0]).toContain('123원');
  expect(screen.queryByText('로딩중...')).not.toBeInTheDocument();
  expect(screen.getByText('최신 내역 확인 중...')).toBeInTheDocument();
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => finish([{ ...row, amount: 321 }]));
  expect(screen.getByText('321원')).toBeInTheDocument();
});

it.each(['principal', 'member', 'generation', 'household', 'epoch'] as const)('hides previous totals on the very first committed %s transition', async dimension => {
  read.mockResolvedValueOnce([{ ...row, amount: 777 }]);
  const frames: string[] = [];
  const ui = <Profiler id="scope" onRender={() => frames.push(document.body.textContent ?? '')}><StatsPage /></Profiler>;
  const { rerender } = render(ui);
  await screen.findByText('777원');
  let finish!: (rows: Expense[]) => void;
  read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  setClientSessionScope({
    principalUid: dimension === 'principal' ? 'other-uid' : 'uid',
    memberId: dimension === 'member' ? 'other-member' : 'member',
    sessionGeneration: dimension === 'generation' ? 2 : 1,
    householdId: dimension === 'household' ? 'house-2' : 'house-1',
  });
  mockHousehold = { householdKey: dimension === 'household' ? 'house-2' : 'house-1', remoteReadEpoch: dimension === 'epoch' ? 1 : 0 };
  mockCurrentMemberId = dimension === 'member' ? 'other-member' : 'member';
  frames.length = 0;
  rerender(<Profiler id="scope" onRender={() => frames.push(document.body.textContent ?? '')}><StatsPage /></Profiler>);
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.every(frame => !frame.includes('777원'))).toBe(true);
  expect(screen.getAllByText('로딩중...').length).toBeGreaterThan(0);
  await act(async () => finish([{ ...row, amount: 222 }]));
  expect(screen.getByText('222원')).toBeInTheDocument();
});

it('hides the old member on the first context transition even before the global actor scope is replaced', async () => {
  read.mockResolvedValue([{ ...row, amount: 777 }]);
  const frames: string[] = [];
  const { rerender } = render(<Profiler id="member" onRender={() => frames.push(document.body.textContent ?? '')}><StatsPage /></Profiler>);
  await screen.findByText('777원');
  mockCurrentMemberId = 'new-member';
  frames.length = 0;
  rerender(<Profiler id="member" onRender={() => frames.push(document.body.textContent ?? '')}><StatsPage /></Profiler>);
  expect(frames.every(frame => !frame.includes('777원'))).toBe(true);
  expect(read).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText('로딩중...').length).toBeGreaterThan(0);
});

it('keeps the failed edit draft and category modal across background resume revalidation failure', async () => {
  mockCategories = [category('food', 500)];
  read.mockResolvedValueOnce([{ ...row, amount: 10 }]).mockRejectedValueOnce(new Error('offline'));
  jest.mocked(updateExpense).mockRejectedValueOnce(new Error('permission-denied'));
  render(<StatsPage />);
  const editor = await openEditor();
  fireEvent.change(within(editor).getByPlaceholderText('메모를 입력하세요'), { target: { value: '복귀 후에도 보존할 내용' } });
  fireEvent.click(within(editor).getByRole('button', { name: '저장' }));
  await waitFor(() => expect(mockShowAlert).toHaveBeenCalled());
  fireEvent.focus(window);
  await screen.findByRole('alert');
  expect(screen.getByRole('dialog', { name: '지출 수정' })).toBe(editor);
  expect(within(editor).getByDisplayValue('복귀 후에도 보존할 내용')).toBeInTheDocument();
  expect(screen.getByText('1건 · 10원')).toBeInTheDocument();
});

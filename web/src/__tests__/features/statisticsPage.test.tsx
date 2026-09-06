import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import StatsPage from '@/app/stats/page';
import { readExpenseStatistics } from '@/platform/reporting/expenseStatisticsReadModel';
import { deleteExpense, updateExpense } from '@/lib/expenseService';
import type { Expense } from '@/types/expense';
import type { CategoryDocument } from '@/types/category';

let mockHousehold = { householdKey: 'house-1', remoteReadEpoch: 0 };
let mockCategories: CategoryDocument[] = [];
const mockShowAlert = jest.fn();
jest.mock('@/contexts/HouseholdContext', () => ({ useHousehold: () => mockHousehold }));
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
jest.mock('@/components/DonutChart', () => ({ __esModule: true, default: ({ onCategoryClick }: { onCategoryClick: (key: string) => void }) => <button onClick={() => onCategoryClick('food')}>상세</button> }));
const read = jest.mocked(readExpenseStatistics);
const row: Expense = { id: 'a', aggregateVersion: 1, amount: 0, date: '2026-09-01', merchant: '가게', category: 'food', transactionType: 'expense' };
const category = (key: string, budget: number | null, order = 0): CategoryDocument => ({
  id: key, key, label: key, color: '#123456', budget, order, isDefault: false, isActive: true, householdId: 'house-1',
});
beforeEach(() => {
  jest.clearAllMocks();
  mockHousehold = { householdKey: 'house-1', remoteReadEpoch: 0 };
  mockCategories = [];
  read.mockResolvedValue([]);
  mockShowAlert.mockResolvedValue(undefined);
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
  jest.mocked(updateExpense).mockResolvedValue(undefined);
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
  fireEvent.click(screen.getByRole('button', { name: '3개월' }));
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
  commandMock.mockResolvedValueOnce(undefined);
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
  const initialRange = read.mock.calls.at(-1);
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
  expect(read.mock.calls.at(-1)).toEqual(initialRange);
  if (command === 'delete') expect(deleteExpense).toHaveBeenLastCalledWith('a', 1);
  else expect(updateExpense).toHaveBeenLastCalledWith('a', { amount: 27, memo: '실패해도 보존할 메모' }, 1, false);
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
  expect(read).toHaveBeenLastCalledWith('2025-10-01', '2026-09-30');
  fireEvent.click(screen.getByRole('button', { name: '3개월' }));
  await waitFor(() => expect(read).toHaveBeenLastCalledWith('2026-07-01', '2026-09-30'));
  fireEvent.click(screen.getByRole('button', { name: '6개월' }));
  await waitFor(() => expect(read).toHaveBeenLastCalledWith('2026-04-01', '2026-09-30'));
  fireEvent.click(screen.getByRole('button', { name: '직접 선택' }));
  fireEvent.change(screen.getByLabelText('시작 월'), { target: { value: '2026-02' } });
  await waitFor(() => expect(read).toHaveBeenLastCalledWith('2025-10-01', '2026-09-30'));
  fireEvent.change(screen.getByLabelText('종료 월'), { target: { value: '2026-03' } });
  await waitFor(() => expect(read).toHaveBeenLastCalledWith('2026-02-01', '2026-03-31'));
});

it('discards previous household response and rejects a reversed period before reading', async () => {
  let resolve!: (rows: Expense[]) => void;
  read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const { rerender } = render(<StatsPage />);
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

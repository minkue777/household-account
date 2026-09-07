import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AssetProfitChart from '@/components/assets/AssetProfitChart';
import { readAssetStatisticsHistory } from '@/platform/reporting/assetStatisticsReadModel';
import type { AssetHistoryEntry } from '@/types/asset';
import { getTodayLocalDate, getSeoulCalendarParts, formatLocalDate } from '@/lib/utils/date';
jest.mock('@/contexts/HouseholdContext', () => ({ useHousehold: () => ({ householdKey: 'home', isSessionVerified: true }) }));
jest.mock('@/platform/reporting/assetStatisticsReadModel', () => ({ readAssetStatisticsHistory: jest.fn() }));
jest.mock('react-chartjs-2', () => ({ Bar: ({ data }: { data: unknown }) => <output>{JSON.stringify(data)}</output> }));
const read = jest.mocked(readAssetStatisticsHistory);
const entry = (date: string): AssetHistoryEntry => ({ id: date, householdId: 'home', assetId: 'TOTAL', date, balance: 0, changeAmount: 0, createdAt: new Date() });
beforeEach(() => { jest.clearAllMocks(); read.mockResolvedValue([]); });
it('reads the chart own month and year and does not turn missing or failed sources into zero', async () => {
  render(<AssetProfitChart />);
  await screen.findByText('변동 데이터가 없습니다');
  const initialStart = read.mock.calls[0][0]!;
  read.mockResolvedValueOnce([entry(initialStart)]);
  fireEvent.click(screen.getByRole('button', { name: '월별' }));
  fireEvent.click(await screen.findByRole('button', { name: '월별 자산 변동' }));
  await screen.findByText('0원');
  expect(read.mock.calls.at(-1)?.[0]).toMatch(/-01-01$/);
  read.mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: '이전 변동 기간' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('0원')).not.toBeInTheDocument();
});
it('ignores an earlier month response arriving after the next period', async () => {
  let resolve!: (rows: AssetHistoryEntry[]) => void;
  read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  render(<AssetProfitChart />);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: '이전 변동 기간' }));
  await screen.findByText('변동 데이터가 없습니다');
  await act(async () => resolve([entry(read.mock.calls[0][0]!)]));
  expect(screen.queryByText('0원')).not.toBeInTheDocument();
});

it('preserves the observed change when today is the only snapshot and the live balance arrives', async () => {
  read.mockResolvedValueOnce([{ ...entry(getTodayLocalDate()), balance: 1000, changeAmount: 200 }]);
  render(<AssetProfitChart currentBalance={1000} />);
  fireEvent.click(await screen.findByRole('button', { name: '일별 자산 변동' }));
  expect(screen.getByText('+200원')).toBeInTheDocument();
  expect(screen.getByText('+25.00%')).toBeInTheDocument();
});

it('uses shared history for month, year and snapshot changes without another read or loading state', () => {
  const { year, month } = getSeoulCalendarParts();
  const previousMonth = formatLocalDate(new Date(year, month - 2, 1));
  const previousYear = `${year - 1}-01-01`;
  const sourceHistory = [
    { ...entry(previousYear), balance: 500, changeAmount: 100 },
    { ...entry(previousMonth), balance: 800, changeAmount: 300 },
    { ...entry(getTodayLocalDate()), balance: 1000, changeAmount: 200 },
    { ...entry(getTodayLocalDate()), assetId: 'FINANCIAL', balance: 400, changeAmount: 50 },
  ];
  const { rerender } = render(<AssetProfitChart sourceHistory={sourceHistory} currentBalance={1000} />);
  fireEvent.click(screen.getByRole('button', { name: '일별 자산 변동' }));
  expect(screen.getByText('+200원')).toBeInTheDocument();
  expect(screen.getByText('+25.00%')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '이전 변동 기간' }));
  expect(screen.getByText('+300원')).toBeInTheDocument();
  expect(screen.getByText('+60.00%')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '다음 변동 기간' }));
  fireEvent.click(screen.getByRole('button', { name: '월별' }));
  fireEvent.click(screen.getByRole('button', { name: '이전 변동 기간' }));
  expect(screen.getByText('+100원')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '다음 변동 기간' }));
  rerender(<AssetProfitChart sourceHistory={sourceHistory} snapshotId="FINANCIAL" currentBalance={400} />);
  expect(screen.getByText('+50원')).toBeInTheDocument();
  expect(screen.queryByText('+200원')).not.toBeInTheDocument();
  expect(screen.queryByText('변동 내역을 불러오는 중...')).not.toBeInTheDocument();
  expect(read).not.toHaveBeenCalled();
});

it('keeps a confirmed empty shared history empty without a fallback request', () => {
  render(<AssetProfitChart sourceHistory={[]} />);
  expect(screen.getByText('변동 데이터가 없습니다')).toBeInTheDocument();
  expect(screen.queryByText('변동 내역을 불러오는 중...')).not.toBeInTheDocument();
  expect(read).not.toHaveBeenCalled();
});

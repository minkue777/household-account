import { fireEvent, render, screen } from '@testing-library/react';
import AssetProfitChart from '@/components/assets/AssetProfitChart';
import { withCurrentAssetBalance } from '@/features/reporting/assetBalanceHistory';
import type { AssetHistoryEntry } from '@/types/asset';
import { getTodayLocalDate, getSeoulCalendarParts, formatLocalDate } from '@/lib/utils/date';
const mockBarInputs = jest.fn();
jest.mock('react-chartjs-2', () => ({ Bar: ({ data, options }: { data: unknown; options: unknown }) => {
  mockBarInputs(data, options);
  return <output>{JSON.stringify(data)}</output>;
} }));
const entry = (date: string): AssetHistoryEntry => ({ id: date, householdId: 'home', assetId: 'TOTAL', date, balance: 0, changeAmount: 0, createdAt: new Date() });
beforeEach(() => { jest.clearAllMocks(); });

it('distinguishes missing observations from a confirmed zero change', () => {
  const { rerender } = render(<AssetProfitChart sourceHistory={[]} />);
  expect(screen.getByText('변동 데이터가 없습니다')).toBeInTheDocument();
  rerender(<AssetProfitChart sourceHistory={[entry(getTodayLocalDate())]} />);
  fireEvent.click(screen.getByRole('button', { name: '월별' }));
  fireEvent.click(screen.getByRole('button', { name: '월별 자산 변동' }));
  expect(screen.getByText('0원')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '이전 변동 기간' }));
  expect(screen.getByText('변동 데이터가 없습니다')).toBeInTheDocument();
  expect(screen.queryByText('0원')).not.toBeInTheDocument();
});

it('preserves the observed change when today is the only snapshot and the live balance arrives', () => {
  const sourceHistory = [{ ...entry(getTodayLocalDate()), balance: 1000, changeAmount: 200 }];
  render(<AssetProfitChart sourceHistory={withCurrentAssetBalance(sourceHistory.filter(entry => entry.assetId === 'TOTAL'), 1000, getTodayLocalDate())} />);
  fireEvent.click(screen.getByRole('button', { name: '일별 자산 변동' }));
  expect(screen.getByText('+200원')).toBeInTheDocument();
  expect(screen.getByText('+25.00%')).toBeInTheDocument();
});

it('uses supplied history for local month, year and snapshot changes', () => {
  const { year, month } = getSeoulCalendarParts();
  const previousMonth = formatLocalDate(new Date(year, month - 2, 1));
  const previousYear = `${year - 1}-01-01`;
  const sourceHistory = [
    { ...entry(previousYear), balance: 500, changeAmount: 100 },
    { ...entry(previousMonth), balance: 800, changeAmount: 300 },
    { ...entry(getTodayLocalDate()), balance: 1000, changeAmount: 200 },
    { ...entry(getTodayLocalDate()), assetId: 'FINANCIAL', balance: 400, changeAmount: 50 },
  ];
  const { rerender } = render(<AssetProfitChart sourceHistory={withCurrentAssetBalance(sourceHistory.filter(entry => entry.assetId === 'TOTAL'), 1000, getTodayLocalDate())} />);
  expect(mockBarInputs.mock.calls.at(-1)![1].animation).toEqual({ duration: 150 });
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
  rerender(<AssetProfitChart sourceHistory={withCurrentAssetBalance(sourceHistory.filter(entry => entry.assetId === 'FINANCIAL'), 400, getTodayLocalDate())} />);
  expect(screen.getByText('+50원')).toBeInTheDocument();
  expect(screen.queryByText('+200원')).not.toBeInTheDocument();
  expect(screen.queryByText('변동 내역을 불러오는 중...')).not.toBeInTheDocument();
});

it('keeps a confirmed empty history distinct from loading', () => {
  render(<AssetProfitChart sourceHistory={[]} />);
  expect(screen.getByText('변동 데이터가 없습니다')).toBeInTheDocument();
  expect(screen.queryByText('변동 내역을 불러오는 중...')).not.toBeInTheDocument();
});

it('preserves gaps, observed zero and signed changes across daily and monthly boundaries', () => {
  const { year } = getSeoulCalendarParts();
  const values = [
    [`${year - 1}-12-31`, 100, 0],
    [`${year}-01-01`, 0, -100],
    [`${year}-01-03`, 0, 0],
    [`${year}-01-15`, -50, -50],
    [`${year}-02-01`, 100, 150],
  ] as const;
  const sourceHistory = values.map(([date, balance, changeAmount]) => ({ ...entry(date), balance, changeAmount }));
  render(<AssetProfitChart sourceHistory={sourceHistory} />);
  fireEvent.click(screen.getByRole('button', { name: '월별' }));
  expect(mockBarInputs.mock.calls.at(-1)![0].datasets[0].data)
    .toEqual([-150, 150, ...Array(10).fill(null)]);
  fireEvent.click(screen.getByRole('button', { name: '월별 자산 변동' }));
  expect(screen.getByText('-150.00%')).toBeInTheDocument();
  expect(screen.getByText('+300.00%')).toBeInTheDocument();
  expect(screen.getByText('-150원')).toBeInTheDocument();
  expect(screen.getByText('+150원')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '일별' }));
  const { month } = getSeoulCalendarParts();
  for (let index = 1; index < month; index++) fireEvent.click(screen.getByRole('button', { name: '이전 변동 기간' }));
  const january = mockBarInputs.mock.calls.at(-1)![0].datasets[0].data;
  expect(january).toHaveLength(31);
  expect(january[0]).toBe(-100);
  expect(january[1]).toBeNull();
  expect(january[2]).toBe(0);
  expect(january[14]).toBe(-50);
  expect(january.filter((value: number | null) => value !== null)).toEqual([-100, 0, -50]);
});

it('keeps chart inputs stable when only its detail table or parent rerenders', () => {
  const sourceHistory = [{ ...entry(getTodayLocalDate()), balance: 1000, changeAmount: 200 }];
  const { rerender } = render(<AssetProfitChart sourceHistory={sourceHistory} />);
  const [data, options] = mockBarInputs.mock.calls.at(-1)!;
  fireEvent.click(screen.getByRole('button', { name: '일별 자산 변동' }));
  expect(screen.getByText('+200원')).toBeInTheDocument();
  const renders = mockBarInputs.mock.calls.length;
  rerender(<AssetProfitChart sourceHistory={sourceHistory} />);
  expect(mockBarInputs).toHaveBeenCalledTimes(renders);
  expect(mockBarInputs.mock.calls.at(-1)![0]).toBe(data);
  expect(mockBarInputs.mock.calls.at(-1)![1]).toBe(options);
});

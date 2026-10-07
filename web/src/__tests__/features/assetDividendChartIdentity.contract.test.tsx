import { act, render, screen, waitFor } from '@testing-library/react';
import AssetDividendChart from '@/components/assets/AssetDividendChart';
import { getAllStockHoldings, getDividendEventsByYear, getDividendSnapshot } from '@/lib/assetService';
import { clearClientSessionScope, setClientSessionScope } from '@/composition/clientSessionScope';
import { getSeoulCalendarParts } from '@/lib/utils/date';

jest.mock('@/lib/assetService', () => ({ getAllStockHoldings: jest.fn(), getDividendEventsByYear: jest.fn(), getDividendSnapshot: jest.fn() }));
jest.mock('@/lib/utils/date', () => ({ getSeoulCalendarParts: jest.fn(() => ({ year: 2026, month: 9, day: 6 })), getTodayLocalDate: () => '2026-09-06' }));
const mockDividendOptions = jest.fn();
jest.mock('react-chartjs-2', () => ({ Bar: ({ data, options }: { data: unknown; options: unknown }) => {
  mockDividendOptions(options);
  return <pre data-testid="dividend-chart">{JSON.stringify(data)}</pre>;
} }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getSeoulCalendarParts).mockReturnValue({ year: 2026, month: 9, day: 6 });
  setClientSessionScope({ principalUid: 'uid', memberId: 'member', householdId: 'house', sessionGeneration: 1 });
});
afterEach(clearClientSessionScope);

test('[DIV-004] excludes the confirmed event identity and record-date-today estimates while retaining a distinct disclosure with identical payment facts', async () => {
  jest.mocked(getAllStockHoldings).mockResolvedValue([{ stockCode: 'ETF', holdingType: 'stock', quantity: 2 }] as never);
  jest.mocked(getDividendSnapshot).mockResolvedValue({ monthlyData: Array(12).fill(0), events: { confirmed: { stockCode: 'ETF', stockName: 'ETF', paymentDate: '2026-09-20', perShareAmount: 100, quantity: 2, totalAmount: 200 } } } as never);
  const event = { stockCode: 'ETF', stockName: 'ETF', status: 'announced', recordDate: '2026-09-10', paymentDate: '2026-09-20', perShareAmount: 100, totalAmount: null };
  jest.mocked(getDividendEventsByYear).mockResolvedValue([
    { ...event, eventId: 'confirmed' },
    { ...event, eventId: 'different-disclosure' },
    { ...event, eventId: 'today', recordDate: '2026-09-06', perShareAmount: 900 },
  ] as never);
  const { rerender } = render(<AssetDividendChart />);
  await waitFor(() => {
    const data = JSON.parse(screen.getByTestId('dividend-chart').textContent!);
    expect(data.datasets[1].data[8]).toBe(200);
  });
  expect(getDividendEventsByYear).toHaveBeenCalledWith(2026);
  expect(mockDividendOptions.mock.calls.at(-1)![0].animation).toEqual({ duration: 150 });
  const renders = mockDividendOptions.mock.calls.length;
  rerender(<AssetDividendChart />);
  expect(mockDividendOptions).toHaveBeenCalledTimes(renders);
});

test('uses the year at entry when a new year begins without reloading the application', async () => {
  jest.mocked(getAllStockHoldings).mockResolvedValue([]);
  jest.mocked(getDividendSnapshot).mockResolvedValue(null);
  jest.mocked(getDividendEventsByYear).mockResolvedValue([]);
  const { unmount } = render(<AssetDividendChart />);
  await screen.findByText('2026년');
  unmount();

  jest.mocked(getSeoulCalendarParts).mockReturnValue({ year: 2027, month: 1, day: 1 });
  render(<AssetDividendChart />);
  await waitFor(() => expect(getDividendSnapshot).toHaveBeenLastCalledWith(2027));
  expect(screen.getByText('2027년')).toBeInTheDocument();
});

test('[DIV-001][DIV-002] keeps canonical monthly totals and adds only eligible rounded estimates to their payment month', async () => {
  jest.mocked(getAllStockHoldings).mockResolvedValue([
    { stockCode: ' etf ', holdingType: 'stock', quantity: 2 },
    { stockCode: 'ETF', holdingType: 'stock', quantity: 3 },
  ] as never);
  const monthlyData = Array(12).fill(0);
  monthlyData[8] = 700;
  monthlyData[9] = 80;
  jest.mocked(getDividendSnapshot).mockResolvedValue({
    monthlyData,
    events: {
      confirmed: { stockCode: 'ETF', stockName: '확정', paymentDate: '2026-09-20', perShareAmount: 10, quantity: 2, totalAmount: 20 },
    },
  });
  const event = {
    stockCode: 'ETF', stockName: '예상', status: 'announced', recordDate: '2026-09-10',
    paymentDate: '2026-09-20', perShareAmount: 10.1, totalAmount: null,
  };
  jest.mocked(getDividendEventsByYear).mockResolvedValue([
    { ...event, eventId: 'september' },
    { ...event, eventId: 'october', paymentDate: '2026-10-20', perShareAmount: 11.7 },
    { ...event, eventId: 'confirmed' },
    { ...event, eventId: 'fixed', status: 'fixed' },
    { ...event, eventId: 'already-totaled', totalAmount: 0 },
    { ...event, eventId: 'today', recordDate: '2026-09-06' },
    { ...event, eventId: 'missing-record-date', recordDate: '' },
    { ...event, eventId: 'no-holding', stockCode: 'OTHER' },
    { ...event, eventId: 'zero-dividend', perShareAmount: 0 },
    { ...event, eventId: 'another-year', paymentDate: '2027-09-20' },
    { ...event, eventId: 'invalid-month', paymentDate: '2026-13-20' },
    { ...event, eventId: 'missing-month', paymentDate: '2026-invalid-20' },
  ] as never);

  render(<AssetDividendChart />);
  await screen.findByText('890원');
  const chart = JSON.parse(screen.getByTestId('dividend-chart').textContent!);
  expect(chart.datasets[0].data).toEqual(monthlyData);
  expect(chart.datasets[1].data).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 51, 59, 0, 0]);
});

test('[DIV-001][DIV-002] filters combined month details and sorts by payment date, confirmed status and stock name', async () => {
  jest.mocked(getAllStockHoldings).mockResolvedValue([{ stockCode: 'ETF', holdingType: 'stock', quantity: 2 }] as never);
  const confirmed = { stockCode: 'ETF', paymentDate: '2026-09-20', perShareAmount: 10, quantity: 2, totalAmount: 20 };
  const monthlyData = Array(12).fill(0);
  monthlyData[8] = 500;
  jest.mocked(getDividendSnapshot).mockResolvedValue({
    monthlyData,
    events: {
      second: { ...confirmed, stockName: '나 확정' },
      first: { ...confirmed, stockName: '가 확정' },
      earlier: { ...confirmed, stockName: '이전 지급', paymentDate: '2026-09-19' },
      otherMonth: { ...confirmed, stockName: '다른 달 확정', paymentDate: '2026-10-20' },
      otherYear: { ...confirmed, stockName: '다른 해 확정', paymentDate: '2025-09-20' },
    },
  });
  const estimated = {
    stockCode: 'ETF', status: 'announced', recordDate: '2026-09-10',
    paymentDate: '2026-09-20', perShareAmount: 10, totalAmount: null,
  };
  jest.mocked(getDividendEventsByYear).mockResolvedValue([
    { ...estimated, eventId: 'estimate-b', stockName: '나 예상' },
    { ...estimated, eventId: 'estimate-a', stockName: '가 예상' },
    { ...estimated, eventId: 'latest', stockName: '최근 지급', paymentDate: '2026-09-21' },
    { ...estimated, eventId: 'other-month', stockName: '다른 달 예상', paymentDate: '2026-10-20' },
    { ...estimated, eventId: 'other-year', stockName: '다른 해 예상', paymentDate: '2027-09-20' },
  ] as never);

  render(<AssetDividendChart />);
  await screen.findByText('580원');
  act(() => mockDividendOptions.mock.calls.at(-1)![0].onClick({}, [{ index: 8 }]));
  expect(screen.getByText('9월 배당금')).toBeInTheDocument();
  expect(screen.getAllByText(/^(최근 지급|가 확정|나 확정|가 예상|나 예상|이전 지급)$/).map(element => element.textContent))
    .toEqual(['최근 지급', '가 확정', '나 확정', '가 예상', '나 예상', '이전 지급']);
  expect(screen.getByText('120원')).toBeInTheDocument();
  expect(screen.queryByText(/다른 (달|해) (확정|예상)/)).not.toBeInTheDocument();
});

test('[DIV-001] hides zero eligible quantities but retains historical dividends after sale and positive fractional quantities', async () => {
  jest.mocked(getAllStockHoldings).mockResolvedValue([]);
  jest.mocked(getDividendEventsByYear).mockResolvedValue([]);
  const base = { stockCode: 'ETF', paymentDate: '2026-09-20', perShareAmount: 10 };
  const monthlyData = Array(12).fill(0);
  monthlyData[8] = 30;
  const snapshot = {
    monthlyData,
    events: {
      zero: { ...base, stockName: '기준 수량 없음', quantity: 0, totalAmount: 0 },
      sold: { ...base, stockName: '현재 전량 매도', quantity: 3, totalAmount: 30 },
      fractional: { ...base, stockName: '소수 수량 배당', quantity: 0.01, totalAmount: 0 },
    },
  };
  jest.mocked(getDividendSnapshot).mockResolvedValue(snapshot);

  render(<AssetDividendChart />);
  await screen.findByText('30원');
  act(() => mockDividendOptions.mock.calls.at(-1)![0].onClick({}, [{ index: 8 }]));

  expect(screen.queryByText('기준 수량 없음')).not.toBeInTheDocument();
  expect(screen.getByText('현재 전량 매도')).toBeInTheDocument();
  expect(screen.getByText('3주')).toBeInTheDocument();
  expect(screen.getByText('소수 수량 배당')).toBeInTheDocument();
  expect(screen.getByText('0.01주')).toBeInTheDocument();
  expect(screen.getAllByText('30원')).toHaveLength(3);
  expect(JSON.parse(screen.getByTestId('dividend-chart').textContent!).datasets[0].data).toEqual(monthlyData);
  expect(snapshot.events.zero.quantity).toBe(0);
});

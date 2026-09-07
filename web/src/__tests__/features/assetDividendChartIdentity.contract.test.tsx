import { render, screen, waitFor } from '@testing-library/react';
import AssetDividendChart from '@/components/assets/AssetDividendChart';
import { getAllStockHoldings, getDividendEventsByYear, getDividendSnapshot } from '@/lib/assetService';
import { clearClientSessionScope, setClientSessionScope } from '@/composition/clientSessionScope';

jest.mock('@/lib/assetService', () => ({ getAllStockHoldings: jest.fn(), getDividendEventsByYear: jest.fn(), getDividendSnapshot: jest.fn() }));
jest.mock('@/lib/utils/date', () => ({ getSeoulCalendarParts: () => ({ year: 2026, month: 9, day: 6 }), getTodayLocalDate: () => '2026-09-06' }));
jest.mock('react-chartjs-2', () => ({ Bar: ({ data }: { data: unknown }) => <pre data-testid="dividend-chart">{JSON.stringify(data)}</pre> }));

beforeEach(() => setClientSessionScope({ principalUid: 'uid', memberId: 'member', householdId: 'house', sessionGeneration: 1 }));
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
  render(<AssetDividendChart />);
  await waitFor(() => {
    const data = JSON.parse(screen.getByTestId('dividend-chart').textContent!);
    expect(data.datasets[1].data[8]).toBe(200);
  });
  expect(getDividendEventsByYear).toHaveBeenCalledWith(2026);
});

import { getHouseholdQueryClient } from '@/composition/webQueryRuntime';
import { portfolioQueries } from '@/features/portfolio/application/portfolioQueries';

jest.mock('@/composition/webQueryRuntime', () => ({
  getHouseholdQueryClient: jest.fn(),
}));

const mockedGetClient = getHouseholdQueryClient as jest.MockedFunction<
  typeof getHouseholdQueryClient
>;

describe('portfolio query contract', () => {
  test('uses the authenticated household query boundary for stock catalog search', async () => {
    const execute = jest.fn().mockResolvedValue({
      items: [
        {
          market: 'US',
          instrumentType: 'etf',
          code: 'US:SPY',
          name: 'SPDR S&P 500 ETF Trust',
        },
      ],
      truncated: false,
      stale: false,
    });
    mockedGetClient.mockReturnValue({ execute } as never);

    await expect(portfolioQueries.searchStocks('SPY')).resolves.toEqual([
      {
        market: 'US',
        instrumentType: 'etf',
        code: 'US:SPY',
        name: 'SPDR S&P 500 ETF Trust',
      },
    ]);
    expect(execute).toHaveBeenCalledWith('portfolio.search-instruments.v1', {
      assetClass: 'stock',
      query: 'SPY',
      limit: 10,
    });
  });

  test('sends the selected market explicitly when requesting a quote', async () => {
    const execute = jest.fn().mockResolvedValue({
      instrument: {
        market: 'KOFIA_FUND',
        instrumentType: 'fund',
        code: 'FUND:K55301EW0012',
        name: '국민성장펀드',
        priceScale: 1_000,
      },
      priceInWon: 1_001.19,
      observedAt: '2026-07-21T01:00:00.000Z',
      provider: 'miraeasset-fund-nav',
      quoteAsOf: '2026-07-20',
    });
    mockedGetClient.mockReturnValue({ execute } as never);

    await expect(
      portfolioQueries.getStockQuote({
        market: 'KOFIA_FUND',
        instrumentType: 'fund',
        code: 'FUND:K55301EW0012',
        name: '국민성장펀드',
        priceScale: 1_000,
      })
    ).resolves.toMatchObject({ price: 1_001.19, quoteAsOf: '2026-07-20' });
    expect(execute).toHaveBeenCalledWith('portfolio.get-instrument-quote.v1', {
      market: 'KOFIA_FUND',
      code: 'FUND:K55301EW0012',
      name: '국민성장펀드',
      instrumentType: 'fund',
      priceScale: 1_000,
    });
  });

  test('reads dividends from the household projection instead of a public Web proxy', async () => {
    const projection = {
      code: '005930',
      name: '삼성전자',
      recentDividend: 365,
      paymentDate: '2026-06-01',
      frequency: 4,
      dividendYield: null,
      annualDividendPerShare: 1_460,
      isEstimated: false,
      paymentEvents: [{ paymentDate: '2026-06-01', dividend: 365 }],
    };
    const execute = jest.fn().mockResolvedValue(projection);
    mockedGetClient.mockReturnValue({ execute } as never);

    await expect(portfolioQueries.getDividendProjection('005930')).resolves.toEqual(
      projection
    );
    expect(execute).toHaveBeenCalledWith('portfolio.get-dividend-projection.v1', {
      instrumentCode: '005930',
    });
  });
});

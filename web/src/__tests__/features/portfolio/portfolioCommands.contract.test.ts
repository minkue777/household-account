import { getHouseholdCommandClient } from '@/composition/webCommandRuntime';
import { portfolioCommands } from '@/features/portfolio/application/portfolioCommands';

jest.mock('@/composition/webCommandRuntime', () => ({
  getHouseholdCommandClient: jest.fn(),
}));

const mockedGetClient = getHouseholdCommandClient as jest.MockedFunction<
  typeof getHouseholdCommandClient
>;

describe('portfolio command contract', () => {
  test('sends the selected market explicitly instead of deriving it from the stock code', async () => {
    const execute = jest.fn().mockResolvedValue({ positionId: 'position-1' });
    mockedGetClient.mockReturnValue({ execute } as never);

    await expect(
      portfolioCommands.addPosition('house-1', 'stock', {
        assetId: 'asset-1',
        holdingType: 'stock',
        stockCode: 'US:AAPL',
        stockName: 'Apple',
        market: 'US',
        quantity: 2,
        avgPrice: 100_000,
        currentPrice: 140_000,
      }),
    ).resolves.toBe('position-1');

    expect(execute).toHaveBeenCalledWith(
      'portfolio.add-position.v1',
      {
        assetId: 'asset-1',
        positionKind: 'stock',
        position: expect.objectContaining({
          stockCode: 'US:AAPL',
          market: 'US',
        }),
      },
      { householdId: 'house-1' },
    );
  });

  test('scopes a manual market refresh to the selected asset', async () => {
    const execute = jest.fn().mockResolvedValue({ refreshedCount: 2 });
    mockedGetClient.mockReturnValue({ execute } as never);

    await expect(
      portfolioCommands.refreshMarketValues('house-1', 'stock', 'asset-1'),
    ).resolves.toBe(2);

    expect(execute).toHaveBeenCalledWith(
      'portfolio.refresh-market-values.v1',
      { assetClass: 'stock', assetId: 'asset-1' },
      { householdId: 'house-1' },
    );
  });
});

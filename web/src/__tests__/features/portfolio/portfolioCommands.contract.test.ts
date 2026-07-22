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

  test('uses a fixed command id for an optimistic position id when provided', async () => {
    const execute = jest.fn().mockResolvedValue({ positionId: 'position-house-1-command-1' });
    mockedGetClient.mockReturnValue({ execute } as never);

    await portfolioCommands.addPosition(
      'house-1',
      'stock',
      {
        assetId: 'asset-1',
        stockCode: '005930',
        stockName: '삼성전자',
        market: 'KRX',
        quantity: 1,
      },
      'command-1'
    );

    expect(execute).toHaveBeenCalledWith(
      'portfolio.add-position.v1',
      expect.objectContaining({ assetId: 'asset-1', positionKind: 'stock' }),
      {
        householdId: 'house-1',
        commandId: 'command-1',
        idempotencyKey: 'command-1',
      }
    );
  });

  test('sends aggregate versions for asset and position mutations', async () => {
    const execute = jest.fn().mockResolvedValue({});
    mockedGetClient.mockReturnValue({ execute } as never);

    await portfolioCommands.updateAsset('house-1', 'asset-1', { memo: '수정' }, 7);
    await portfolioCommands.deleteAsset('house-1', 'asset-1', 8);
    await portfolioCommands.updatePosition(
      'house-1',
      'stock',
      'position-1',
      'asset-1',
      { quantity: 2 },
      4
    );
    await portfolioCommands.deletePosition(
      'house-1',
      'stock',
      'position-1',
      'asset-1',
      5
    );

    expect(execute).toHaveBeenNthCalledWith(
      1,
      'portfolio.update-asset.v1',
      { assetId: 'asset-1', changes: { memo: '수정' }, expectedVersion: 7 },
      { householdId: 'house-1' }
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      'portfolio.delete-asset.v1',
      { assetId: 'asset-1', expectedVersion: 8 },
      { householdId: 'house-1' }
    );
    expect(execute).toHaveBeenNthCalledWith(
      3,
      'portfolio.update-position.v1',
      {
        assetId: 'asset-1',
        positionId: 'position-1',
        positionKind: 'stock',
        changes: { quantity: 2 },
        expectedVersion: 4,
      },
      { householdId: 'house-1' }
    );
    expect(execute).toHaveBeenNthCalledWith(
      4,
      'portfolio.delete-position.v1',
      {
        assetId: 'asset-1',
        positionId: 'position-1',
        positionKind: 'stock',
        expectedVersion: 5,
      },
      { householdId: 'house-1' }
    );
  });

  test('[T-HOLD-001][HOLD-001] 수동 보유 항목 수정 payload에서 undefined는 미변경으로 생략하고 현재가는 보존한다', async () => {
    const execute = jest.fn().mockResolvedValue({});
    mockedGetClient.mockReturnValue({ execute } as never);

    await portfolioCommands.updatePosition(
      'house-1',
      'stock',
      'legacy-cash-1',
      'asset-1',
      {
        stockName: '예수금',
        quantity: 1,
        avgPrice: undefined,
        currentPrice: 1_500_000,
      },
      3
    );

    expect(execute).toHaveBeenCalledWith(
      'portfolio.update-position.v1',
      {
        assetId: 'asset-1',
        positionId: 'legacy-cash-1',
        positionKind: 'stock',
        changes: {
          stockName: '예수금',
          quantity: 1,
          currentPrice: 1_500_000,
        },
        expectedVersion: 3,
      },
      { householdId: 'house-1' }
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

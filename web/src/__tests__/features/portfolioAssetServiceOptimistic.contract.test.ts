import { portfolioCommands } from '@/features/portfolio/application/portfolioCommands';
import {
  portfolioOptimisticProjection,
  stockHoldingOptimisticProjection,
} from '@/features/portfolio/application/portfolioOptimisticProjection';
import {
  addAsset,
  addStockHolding,
  deleteStockHolding,
  refreshAllMarketValues,
  updateAsset,
  updateStockHolding,
} from '@/lib/assetService';
import type { Asset, StockHolding } from '@/types/asset';
import { resetClientOptimisticProjections } from '@/composition/resetClientOptimisticProjections';

jest.mock('@/composition/clientSessionScope', () => ({
  requireClientSessionScope: () => ({ householdId: 'house-1', memberId: 'member-1' }),
}));

jest.mock('@/features/portfolio/application/portfolioCommands', () => ({
  portfolioCommands: {
    createAsset: jest.fn(),
    updateAsset: jest.fn(),
    deleteAsset: jest.fn(),
    reorderAssets: jest.fn(),
    addPosition: jest.fn(),
    updatePosition: jest.fn(),
    deletePosition: jest.fn(),
    refreshMarketValues: jest.fn(),
  },
}));

const mockedCommands = portfolioCommands as jest.Mocked<typeof portfolioCommands>;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    aggregateVersion: 3,
    householdId: 'house-1',
    name: '예금',
    type: 'savings',
    currentBalance: 1_000_000,
    currency: 'KRW',
    isActive: true,
    order: 0,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

function holding(overrides: Partial<StockHolding> = {}): StockHolding {
  return {
    id: 'position-1',
    aggregateVersion: 5,
    assetId: 'asset-1',
    householdId: 'house-1',
    holdingType: 'stock',
    stockCode: '005930',
    stockName: '삼성전자',
    market: 'KRX',
    quantity: 10,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

describe('portfolio asset service optimistic contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    portfolioOptimisticProjection.reset();
    stockHoldingOptimisticProjection.reset();
  });

  afterEach(() => {
    portfolioOptimisticProjection.reset();
    stockHoldingOptimisticProjection.reset();
  });

  test('자산 수정은 원격 command 완료 전 반영하고 read model의 버전을 expectedVersion으로 보낸다', async () => {
    const rendered: Asset[][] = [];
    const subscription = portfolioOptimisticProjection.subscribe(
      (items) => rendered.push(items),
      'house-1'
    );
    subscription.publish([asset()]);
    const command = deferred<void>();
    mockedCommands.updateAsset.mockReturnValue(command.promise);

    const pending = updateAsset('asset-1', { memo: '즉시 반영' }, 3);

    expect(rendered.at(-1)?.[0].memo).toBe('즉시 반영');
    expect(mockedCommands.updateAsset).toHaveBeenCalledWith(
      'house-1',
      'asset-1',
      { memo: '즉시 반영' },
      3
    );

    command.resolve();
    await pending;
  });

  test('자산 수정 command가 실패하면 즉시 반영한 값을 rollback한다', async () => {
    const rendered: Asset[][] = [];
    const subscription = portfolioOptimisticProjection.subscribe(
      (items) => rendered.push(items),
      'house-1'
    );
    subscription.publish([asset()]);
    const command = deferred<void>();
    mockedCommands.updateAsset.mockReturnValue(command.promise);

    const pending = updateAsset('asset-1', { name: '실패할 이름' }, 3);
    expect(rendered.at(-1)?.[0].name).toBe('실패할 이름');

    command.reject(new Error('SERVER_FAILED'));
    await expect(pending).rejects.toThrow('SERVER_FAILED');
    expect(rendered.at(-1)?.[0].name).toBe('예금');
  });

  test('열린 편집 화면은 다른 변경의 최신 version을 빌리지 않고 자신이 읽은 version으로 충돌한다', async () => {
    const rendered: Asset[][] = [];
    const subscription = portfolioOptimisticProjection.subscribe(
      (items) => rendered.push(items),
      'house-1'
    );
    subscription.publish([asset()]);

    const precedingMutation = portfolioOptimisticProjection.beginUpdate('asset-1', {
      name: '다른 사용자의 이름',
    });
    portfolioOptimisticProjection.commitUpdate(
      precedingMutation,
      asset({ aggregateVersion: 4, name: '다른 사용자의 이름' })
    );

    const command = deferred<void>();
    mockedCommands.updateAsset.mockReturnValue(command.promise);
    const pending = updateAsset('asset-1', { memo: '오래 열린 화면의 메모' }, 3);

    expect(mockedCommands.updateAsset).toHaveBeenCalledWith(
      'house-1',
      'asset-1',
      { memo: '오래 열린 화면의 메모' },
      3
    );
    expect(rendered.at(-1)?.[0]).toMatchObject({
      name: '다른 사용자의 이름',
      memo: '오래 열린 화면의 메모',
    });

    command.reject(new Error('ASSET_VERSION_MISMATCH'));
    await expect(pending).rejects.toThrow('ASSET_VERSION_MISMATCH');
    expect(rendered.at(-1)?.[0]).toMatchObject({
      aggregateVersion: 4,
      name: '다른 사용자의 이름',
    });
    expect(rendered.at(-1)?.[0].memo).toBeUndefined();
  });

  test('자산·보유 항목 추가는 commandId로 예측한 ID를 같은 tick에 보여준다', async () => {
    const assets: Asset[][] = [];
    const holdings: StockHolding[][] = [];
    const assetSubscription = portfolioOptimisticProjection.subscribe(
      (items) => assets.push(items),
      'house-1'
    );
    const holdingSubscription = stockHoldingOptimisticProjection.subscribe(
      (items) => holdings.push(items),
      (item) => item.assetId.startsWith('asset-')
    );
    assetSubscription.publish([]);
    holdingSubscription.publish([]);
    mockedCommands.createAsset.mockImplementation(async (householdId, _input, commandId) =>
      `asset-${householdId}-${commandId}`
    );
    mockedCommands.addPosition.mockImplementation(async (householdId, _kind, _input, commandId) =>
      `position-${householdId}-${commandId}`
    );

    const assetPending = addAsset({
      name: '새 자산',
      type: 'stock',
      currentBalance: 0,
      currency: 'KRW',
      isActive: true,
      order: 0,
    });
    expect(assets.at(-1)?.[0]).toMatchObject({ name: '새 자산', aggregateVersion: 1 });
    const assetId = await assetPending;

    const holdingPending = addStockHolding({
      assetId,
      stockCode: '005930',
      stockName: '삼성전자',
      market: 'KRX',
      quantity: 1,
    });
    expect(holdings.at(-1)?.[0]).toMatchObject({
      stockName: '삼성전자',
      aggregateVersion: 1,
    });
    await holdingPending;
  });

  test('보유 항목 수정·삭제도 즉시 반영하고 실패 시 rollback한다', async () => {
    const rendered: StockHolding[][] = [];
    const subscription = stockHoldingOptimisticProjection.subscribe(
      (items) => rendered.push(items),
      (item) => item.assetId === 'asset-1'
    );
    subscription.publish([holding()]);
    const updateCommand = deferred<void>();
    mockedCommands.updatePosition.mockReturnValue(updateCommand.promise);

    const updatePending = updateStockHolding('position-1', 'asset-1', { quantity: 20 }, 5);
    expect(rendered.at(-1)?.[0].quantity).toBe(20);
    expect(mockedCommands.updatePosition).toHaveBeenCalledWith(
      'house-1',
      'stock',
      'position-1',
      'asset-1',
      { quantity: 20 },
      5
    );
    updateCommand.reject(new Error('UPDATE_FAILED'));
    await expect(updatePending).rejects.toThrow('UPDATE_FAILED');
    expect(rendered.at(-1)?.[0].quantity).toBe(10);

    const deleteCommand = deferred<void>();
    mockedCommands.deletePosition.mockReturnValue(deleteCommand.promise);
    const deletePending = deleteStockHolding('position-1', 'asset-1', 5);
    expect(rendered.at(-1)).toEqual([]);
    deleteCommand.reject(new Error('DELETE_FAILED'));
    await expect(deletePending).rejects.toThrow('DELETE_FAILED');
    expect(rendered.at(-1)?.[0].id).toBe('position-1');
  });

  test('페이지 중복 mount가 겹쳐도 전체 시세 갱신 command는 한 번만 실행한다', async () => {
    const command = deferred<number>();
    mockedCommands.refreshMarketValues.mockReturnValue(command.promise);

    const first = refreshAllMarketValues();
    const second = refreshAllMarketValues();

    expect(second).toBe(first);
    expect(mockedCommands.refreshMarketValues).toHaveBeenCalledTimes(1);
    expect(mockedCommands.refreshMarketValues).toHaveBeenCalledWith('house-1', 'all');

    command.resolve(2);
    await first;
  });

  test('이전 session의 늦은 command 응답은 reset 뒤 새 session projection에 주입되지 않는다', async () => {
    const oldSubscription = portfolioOptimisticProjection.subscribe(
      () => undefined,
      'house-1'
    );
    oldSubscription.publish([asset()]);
    const command = deferred<void>();
    mockedCommands.updateAsset.mockReturnValue(command.promise);
    const oldPending = updateAsset('asset-1', { memo: '이전 session 변경' }, 3);

    resetClientOptimisticProjections();
    const freshRendered: Asset[][] = [];
    const freshSubscription = portfolioOptimisticProjection.subscribe(
      (items) => freshRendered.push(items),
      'house-1'
    );
    freshSubscription.publish([
      asset({ aggregateVersion: 10, name: '새 session 값', memo: '새 session 메모' }),
    ]);

    command.resolve();
    await oldPending;

    expect(freshRendered.at(-1)?.[0]).toMatchObject({
      aggregateVersion: 10,
      name: '새 session 값',
      memo: '새 session 메모',
    });
  });
});

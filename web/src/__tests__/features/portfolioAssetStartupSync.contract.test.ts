const mockOnSnapshot = jest.fn();

jest.mock('@/platform/read-model/firestoreReadModel', () => ({
  db: { kind: 'db' },
  collection: jest.fn((...segments: unknown[]) => ({ kind: 'collection', segments })),
  doc: jest.fn((...segments: unknown[]) => ({ kind: 'document', segments })),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  query: jest.fn((...constraints: unknown[]) => ({ kind: 'query', constraints })),
  where: jest.fn((...args: unknown[]) => ({ kind: 'where', args })),
  orderBy: jest.fn((...args: unknown[]) => ({ kind: 'orderBy', args })),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  timestampToDate: (value: unknown) => value instanceof Date ? value : undefined,
}));

jest.mock('@/composition/clientSessionScope', () => ({
  requireClientSessionScope: () => ({
    sessionGeneration: 1,
    principalUid: 'uid-1',
    householdId: 'house-1',
    memberId: 'member-1',
    accessMode: 'member',
  }),
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

import { resetClientOptimisticProjections } from '@/composition/resetClientOptimisticProjections';
import { portfolioCommands } from '@/features/portfolio/application/portfolioCommands';
import {
  deleteAsset,
  deleteCryptoHolding,
  deleteStockHolding,
  subscribeToAssets,
  subscribeToHouseholdCryptoHoldings,
  subscribeToHouseholdStockHoldings,
  updateAsset,
  updateAssetOrders,
  updateStockHolding,
} from '@/lib/assetService';
import type { Asset, CryptoHolding, StockHolding } from '@/types/asset';

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
    name: '새마을금고 출자금',
    type: 'savings',
    currentBalance: 20_000_000,
    currency: 'KRW',
    isActive: true,
    order: 0,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

function stockHolding(overrides: Partial<StockHolding> = {}): StockHolding {
  return {
    id: 'stock-1',
    aggregateVersion: 3,
    householdId: 'house-1',
    assetId: 'asset-1',
    holdingType: 'stock',
    stockCode: '005930',
    stockName: '삼성전자',
    market: 'KRX',
    quantity: 10,
    avgPrice: 70_000,
    currentPrice: 80_000,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

function cryptoHolding(overrides: Partial<CryptoHolding> = {}): CryptoHolding {
  return {
    id: 'crypto-1',
    aggregateVersion: 3,
    householdId: 'house-1',
    assetId: 'asset-2',
    marketCode: 'KRW-BTC',
    coinName: '비트코인',
    quantity: 0.1,
    avgPrice: 100_000_000,
    currentPrice: 110_000_000,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

function snapshotAsset(value: Asset | StockHolding | CryptoHolding) {
  const { id, ...data } = value;
  return {
    id,
    data: () => data,
  };
}

function listenerArguments(callIndex = -1) {
  const [, options, next, error] = mockOnSnapshot.mock.calls.at(callIndex) as [
    unknown,
    { includeMetadataChanges: boolean },
    (snapshot: {
      metadata: { fromCache: boolean };
      docs: ReturnType<typeof snapshotAsset>[];
    }) => void,
    (error: unknown) => void,
  ];
  return { options, next, error };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('자산 시작 snapshot과 수정 명령의 동기화 계약', () => {
  beforeEach(() => {
    resetClientOptimisticProjections();
    jest.clearAllMocks();
    mockOnSnapshot.mockReturnValue(jest.fn());
    mockedCommands.updateAsset.mockReset().mockResolvedValue(undefined);
    mockedCommands.deleteAsset.mockReset().mockResolvedValue(undefined);
    mockedCommands.reorderAssets.mockReset().mockResolvedValue(undefined);
    mockedCommands.updatePosition.mockReset().mockResolvedValue(undefined);
    mockedCommands.deletePosition.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetClientOptimisticProjections();
    jest.useRealTimers();
  });

  test('cached 자산은 즉시 보여주되 첫 server snapshot 전 수정 명령은 보내지 않고 안전하게 rebase한다', async () => {
    const rendered: Asset[][] = [];
    const unsubscribe = subscribeToAssets(
      (items) => rendered.push(items),
      [asset()]
    );
    const { options, next } = listenerArguments();
    const command = deferred<void>();
    mockedCommands.updateAsset.mockReturnValue(command.promise);

    const pending = updateAsset(
      'asset-1',
      {
        name: '새마을금고 출자금',
        currentBalance: 20_000_000,
        memo: '사용자가 입력한 메모',
      },
      3
    );

    expect(options).toEqual({ includeMetadataChanges: true });
    expect(rendered.at(-1)?.[0].memo).toBe('사용자가 입력한 메모');
    expect(mockedCommands.updateAsset).not.toHaveBeenCalled();

    next({
      metadata: { fromCache: true },
      docs: [snapshotAsset(asset())],
    });
    await flushPromises();
    expect(mockedCommands.updateAsset).not.toHaveBeenCalled();

    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(asset({
        aggregateVersion: 4,
        name: '외부에서 바꾼 이름',
      }))],
    });
    await flushPromises();

    expect(mockedCommands.updateAsset).toHaveBeenCalledWith(
      'house-1',
      'asset-1',
      { memo: '사용자가 입력한 메모' },
      4
    );
    command.resolve();
    await pending;
    expect(rendered.at(-1)?.[0]).toMatchObject({
      aggregateVersion: 5,
      name: '외부에서 바꾼 이름',
      memo: '사용자가 입력한 메모',
    });
    unsubscribe();
  });

  test('사용자가 수정한 필드가 server에서 먼저 바뀌었으면 자동 rebase하지 않고 충돌시킨다', async () => {
    const rendered: Asset[][] = [];
    const unsubscribe = subscribeToAssets(
      (items) => rendered.push(items),
      [asset({ memo: '기존 메모' })]
    );
    const { next } = listenerArguments();

    const pending = updateAsset('asset-1', { memo: '내 메모' }, 3);
    expect(rendered.at(-1)?.[0].memo).toBe('내 메모');

    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(asset({
        aggregateVersion: 4,
        memo: '다른 기기의 메모',
      }))],
    });

    await expect(pending).rejects.toThrow('ASSET_VERSION_MISMATCH');
    expect(mockedCommands.updateAsset).not.toHaveBeenCalled();
    expect(rendered.at(-1)?.[0]).toMatchObject({
      aggregateVersion: 4,
      memo: '다른 기기의 메모',
    });
    unsubscribe();
  });

  test('unmount 뒤 다시 cached subscribe하면 새 server snapshot 전 수정은 다시 대기한다', async () => {
    const firstUnsubscribe = subscribeToAssets(() => undefined, [asset()]);
    const firstListener = listenerArguments();
    firstListener.next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(asset())],
    });
    firstUnsubscribe();

    const rendered: Asset[][] = [];
    const secondUnsubscribe = subscribeToAssets(
      (items) => rendered.push(items),
      [asset()]
    );
    const secondListener = listenerArguments();
    const command = deferred<void>();
    mockedCommands.updateAsset.mockReturnValue(command.promise);

    const pending = updateAsset('asset-1', { currentBalance: 20_000_001 }, 3);
    expect(rendered.at(-1)?.[0].currentBalance).toBe(20_000_001);
    expect(mockedCommands.updateAsset).not.toHaveBeenCalled();

    secondListener.next({
      metadata: { fromCache: true },
      docs: [snapshotAsset(asset())],
    });
    await flushPromises();
    expect(mockedCommands.updateAsset).not.toHaveBeenCalled();

    secondListener.next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(asset({ aggregateVersion: 4 }))],
    });
    await flushPromises();
    expect(mockedCommands.updateAsset).toHaveBeenCalledWith(
      'house-1',
      'asset-1',
      { currentBalance: 20_000_001 },
      4
    );

    command.resolve();
    await pending;
    secondUnsubscribe();
  });

  test('첫 server snapshot을 기다리는 연속 수정은 fresh version부터 FIFO로 이어진다', async () => {
    const rendered: Asset[][] = [];
    const unsubscribe = subscribeToAssets(
      (items) => rendered.push(items),
      [asset()]
    );
    const { next } = listenerArguments();
    const firstCommand = deferred<void>();
    const secondCommand = deferred<void>();
    mockedCommands.updateAsset
      .mockReturnValueOnce(firstCommand.promise)
      .mockReturnValueOnce(secondCommand.promise);

    const firstPending = updateAsset('asset-1', { memo: '첫 수정' }, 3);
    const firstProjected = rendered.at(-1)![0];
    const secondPending = updateAsset(
      'asset-1',
      {
        memo: '첫 수정',
        currentBalance: 20_000_001,
      },
      firstProjected.aggregateVersion
    );

    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(asset({
        aggregateVersion: 5,
        name: '서버 최신 이름',
      }))],
    });
    await flushPromises();
    expect(mockedCommands.updateAsset).toHaveBeenNthCalledWith(
      1,
      'house-1',
      'asset-1',
      { memo: '첫 수정' },
      5
    );

    firstCommand.resolve();
    await firstPending;
    await flushPromises();
    expect(mockedCommands.updateAsset).toHaveBeenNthCalledWith(
      2,
      'house-1',
      'asset-1',
      { currentBalance: 20_000_001 },
      6
    );

    secondCommand.resolve();
    await secondPending;
    expect(rendered.at(-1)?.[0]).toMatchObject({
      aggregateVersion: 7,
      name: '서버 최신 이름',
      memo: '첫 수정',
      currentBalance: 20_000_001,
    });
    unsubscribe();
  });

  test('첫 snapshot 대기 중 session reset이면 명령을 보내지 않고 즉시 취소한다', async () => {
    const rendered: Asset[][] = [];
    subscribeToAssets((items) => rendered.push(items), [asset()]);

    const pending = updateAsset('asset-1', { memo: '취소할 수정' }, 3);
    expect(rendered.at(-1)?.[0].memo).toBe('취소할 수정');

    resetClientOptimisticProjections();

    await expect(pending).rejects.toThrow('CLIENT_SESSION_RESET');
    expect(mockedCommands.updateAsset).not.toHaveBeenCalled();
  });

  test('첫 snapshot listener가 실패하면 대기하던 수정도 즉시 실패하고 rollback한다', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const rendered: Asset[][] = [];
    const unsubscribe = subscribeToAssets(
      (items) => rendered.push(items),
      [asset()]
    );
    const { error } = listenerArguments();

    const pending = updateAsset('asset-1', { memo: '실패할 수정' }, 3);
    error(new Error('listener failed'));

    await expect(pending).rejects.toThrow('ASSET_AUTHORITATIVE_READ_FAILED');
    expect(mockedCommands.updateAsset).not.toHaveBeenCalled();
    expect(rendered.at(-1)?.[0].memo).toBeUndefined();
    unsubscribe();
    consoleError.mockRestore();
  });

  test('첫 snapshot이 영원히 오지 않아도 수정 promise를 무기한 남기지 않는다', async () => {
    jest.useFakeTimers();
    const unsubscribe = subscribeToAssets(() => undefined, [asset()]);

    const pending = updateAsset('asset-1', { memo: '시간 초과 수정' }, 3);
    jest.advanceTimersByTime(20_000);

    await expect(pending).rejects.toThrow('ASSET_AUTHORITATIVE_READ_TIMEOUT');
    expect(mockedCommands.updateAsset).not.toHaveBeenCalled();
    unsubscribe();
  });

  test('캐시로 편집 폼을 연 뒤 서버 snapshot이 먼저 와도 실제 변경 필드만 최신 version에 반영한다', async () => {
    const cached = asset({ memo: '기존 메모' });
    const unsubscribe = subscribeToAssets(() => undefined, [cached]);
    const { next } = listenerArguments();
    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(asset({
        aggregateVersion: 4,
        name: '서버에서 바꾼 이름',
        memo: '기존 메모',
      }))],
    });

    await updateAsset(
      cached.id,
      {
        name: cached.name,
        currentBalance: cached.currentBalance,
        memo: '새 메모',
      },
      cached.aggregateVersion,
      cached
    );

    expect(mockedCommands.updateAsset).toHaveBeenCalledWith(
      'house-1',
      'asset-1',
      { memo: '새 메모' },
      4
    );
    unsubscribe();
  });

  test('캐시로 연 폼의 변경 필드를 서버가 먼저 바꿨으면 snapshot 도착 뒤에도 충돌로 보존한다', async () => {
    const cached = asset({ memo: '기존 메모' });
    const unsubscribe = subscribeToAssets(() => undefined, [cached]);
    const { next } = listenerArguments();
    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(asset({
        aggregateVersion: 4,
        memo: '다른 기기의 메모',
      }))],
    });

    await expect(updateAsset(
      cached.id,
      { memo: '내 새 메모' },
      cached.aggregateVersion,
      cached
    )).rejects.toThrow('ASSET_VERSION_MISMATCH');
    expect(mockedCommands.updateAsset).not.toHaveBeenCalled();
    unsubscribe();
  });

  test('첫 startup command 전송 뒤 추가 저장도 command floor에서 FIFO로 이어진다', async () => {
    const rendered: Asset[][] = [];
    const unsubscribe = subscribeToAssets(
      (items) => rendered.push(items),
      [asset()]
    );
    const { next } = listenerArguments();
    const firstCommand = deferred<void>();
    const secondCommand = deferred<void>();
    mockedCommands.updateAsset
      .mockReturnValueOnce(firstCommand.promise)
      .mockReturnValueOnce(secondCommand.promise);

    const firstPending = updateAsset('asset-1', { memo: '첫 수정' }, 3);
    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(asset({ aggregateVersion: 5 }))],
    });
    await flushPromises();
    expect(rendered.at(-1)?.[0].aggregateVersion).toBeGreaterThanOrEqual(5);

    const afterServerSnapshot = rendered.at(-1)![0];
    const secondPending = updateAsset(
      'asset-1',
      { currentBalance: 20_000_001 },
      afterServerSnapshot.aggregateVersion
    );
    firstCommand.resolve();
    await firstPending;
    await flushPromises();

    expect(mockedCommands.updateAsset).toHaveBeenNthCalledWith(
      2,
      'house-1',
      'asset-1',
      { currentBalance: 20_000_001 },
      6
    );
    secondCommand.resolve();
    await secondPending;
    unsubscribe();
  });

  test('listener 재구독 사이의 cleanup은 권위 snapshot 대기 중인 저장을 취소하지 않는다', async () => {
    const firstUnsubscribe = subscribeToAssets(() => undefined, [asset()]);
    const pending = updateAsset('asset-1', { memo: '재구독 저장' }, 3);
    firstUnsubscribe();
    await flushPromises();
    expect(mockedCommands.updateAsset).not.toHaveBeenCalled();

    const secondUnsubscribe = subscribeToAssets(() => undefined, [asset()]);
    const { next } = listenerArguments();
    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(asset({ aggregateVersion: 4 }))],
    });
    await pending;
    expect(mockedCommands.updateAsset).toHaveBeenCalledWith(
      'house-1',
      'asset-1',
      { memo: '재구독 저장' },
      4
    );
    secondUnsubscribe();
  });

  test('terminal listener 오류 뒤 새 저장은 20초 timeout 대신 즉시 같은 오류로 실패한다', async () => {
    const unsubscribe = subscribeToAssets(() => undefined, [asset()]);
    const { error } = listenerArguments();
    const firstPending = updateAsset('asset-1', { memo: '첫 저장' }, 3);
    error(new Error('listener failed'));
    await expect(firstPending).rejects.toThrow('ASSET_AUTHORITATIVE_READ_FAILED');

    const secondPending = updateAsset('asset-1', { memo: '두 번째 저장' }, 3);
    await expect(secondPending).rejects.toThrow('ASSET_AUTHORITATIVE_READ_FAILED');
    expect(mockedCommands.updateAsset).not.toHaveBeenCalled();
    unsubscribe();
  });

  test('복수 listener 중 하나의 오류는 다른 listener의 권위 snapshot 대기를 깨지 않는다', async () => {
    const firstUnsubscribe = subscribeToAssets(() => undefined, [asset()]);
    const firstListener = listenerArguments();
    const secondUnsubscribe = subscribeToAssets(() => undefined, [asset()]);
    const secondListener = listenerArguments();
    const pending = updateAsset('asset-1', { memo: '복수 구독 저장' }, 3);

    firstListener.error(new Error('one listener failed'));
    await flushPromises();
    expect(mockedCommands.updateAsset).not.toHaveBeenCalled();

    secondListener.next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(asset({ aggregateVersion: 4 }))],
    });
    await pending;
    expect(mockedCommands.updateAsset).toHaveBeenCalledWith(
      'house-1',
      'asset-1',
      { memo: '복수 구독 저장' },
      4
    );
    firstUnsubscribe();
    secondUnsubscribe();
  });

  test('캐시 자산 삭제는 첫 권위 snapshot까지 기다리고 내용이 같을 때 최신 version을 사용한다', async () => {
    const cached = asset();
    const unsubscribe = subscribeToAssets(() => undefined, [cached]);
    const { next } = listenerArguments();
    const pending = deleteAsset(
      cached.id,
      cached.aggregateVersion,
      cached
    );
    expect(mockedCommands.deleteAsset).not.toHaveBeenCalled();

    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(asset({ aggregateVersion: 4 }))],
    });
    await pending;
    expect(mockedCommands.deleteAsset).toHaveBeenCalledWith(
      'house-1',
      'asset-1',
      4
    );
    unsubscribe();
  });

  test('보유 종목 수정과 삭제도 첫 권위 snapshot 전에는 command를 보내지 않는다', async () => {
    const unsubscribeStock = subscribeToHouseholdStockHoldings(
      () => undefined
    );
    const stockListener = listenerArguments();
    stockListener.next({
      metadata: { fromCache: true },
      docs: [snapshotAsset(stockHolding())],
    });
    const stockPending = updateStockHolding(
      'stock-1',
      'asset-1',
      { quantity: 11 },
      3,
      stockHolding()
    );
    expect(mockedCommands.updatePosition).not.toHaveBeenCalled();
    stockListener.next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(stockHolding({
        aggregateVersion: 4,
        currentPrice: 81_000,
      }))],
    });
    await stockPending;
    expect(mockedCommands.updatePosition).toHaveBeenCalledWith(
      'house-1',
      'stock',
      'stock-1',
      'asset-1',
      { quantity: 11 },
      4
    );
    unsubscribeStock();

    const unsubscribeCrypto = subscribeToHouseholdCryptoHoldings(
      () => undefined
    );
    const cryptoListener = listenerArguments();
    cryptoListener.next({
      metadata: { fromCache: true },
      docs: [snapshotAsset(cryptoHolding())],
    });
    const cryptoPending = deleteCryptoHolding(
      'crypto-1',
      'asset-2',
      3,
      cryptoHolding()
    );
    expect(mockedCommands.deletePosition).not.toHaveBeenCalled();
    cryptoListener.next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(cryptoHolding({ aggregateVersion: 4 }))],
    });
    await cryptoPending;
    expect(mockedCommands.deletePosition).toHaveBeenCalledWith(
      'house-1',
      'crypto',
      'crypto-1',
      'asset-2',
      4
    );
    unsubscribeCrypto();
  });

  test('version mismatch 뒤 floor보다 최신 server snapshot으로 한 번만 안전 재시도한다', async () => {
    const rendered: Asset[][] = [];
    const unsubscribe = subscribeToAssets(
      (items) => rendered.push(items),
      [asset()]
    );
    const { next } = listenerArguments();
    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(asset())],
    });

    await updateAsset('asset-1', { memo: '선행 저장' }, 3, asset());
    const afterFirst = rendered.at(-1)![0];
    const mismatch = Object.assign(
      new Error('asset conflict'),
      { code: 'ASSET_VERSION_MISMATCH' }
    );
    mockedCommands.updateAsset
      .mockRejectedValueOnce(mismatch)
      .mockResolvedValueOnce(undefined);

    const pending = updateAsset(
      'asset-1',
      { currentBalance: 20_000_001 },
      afterFirst.aggregateVersion,
      afterFirst
    );
    await flushPromises();
    expect(mockedCommands.updateAsset).toHaveBeenLastCalledWith(
      'house-1',
      'asset-1',
      { currentBalance: 20_000_001 },
      4
    );

    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(asset({
        aggregateVersion: 5,
        memo: '선행 저장',
        name: '외부에서 바꾼 이름',
      }))],
    });
    await pending;
    expect(mockedCommands.updateAsset).toHaveBeenLastCalledWith(
      'house-1',
      'asset-1',
      { currentBalance: 20_000_001 },
      5
    );
    expect(mockedCommands.updateAsset).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  test('version mismatch 뒤 사용자가 바꾼 같은 필드가 서버에서 달라졌으면 재시도하지 않는다', async () => {
    const cached = asset({ memo: '기존 메모' });
    const unsubscribe = subscribeToAssets(() => undefined, [cached]);
    const { next } = listenerArguments();
    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(cached)],
    });
    const mismatch = Object.assign(
      new Error('asset conflict'),
      { code: 'ASSET_VERSION_MISMATCH' }
    );
    mockedCommands.updateAsset.mockRejectedValueOnce(mismatch);

    const pending = updateAsset(
      cached.id,
      { memo: '내 메모' },
      cached.aggregateVersion,
      cached
    );
    await flushPromises();
    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(asset({
        aggregateVersion: 4,
        memo: '다른 기기의 메모',
      }))],
    });

    await expect(pending).rejects.toThrow('ASSET_VERSION_MISMATCH');
    expect(mockedCommands.updateAsset).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  test('자산 update 직후 delete는 같은 entity FIFO에서 선행 성공 version을 사용한다', async () => {
    const rendered: Asset[][] = [];
    const unsubscribe = subscribeToAssets(
      (items) => rendered.push(items),
      [asset()]
    );
    const { next } = listenerArguments();
    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(asset())],
    });
    const updateCommand = deferred<void>();
    mockedCommands.updateAsset.mockReturnValue(updateCommand.promise);

    const updatePending = updateAsset('asset-1', { memo: '삭제 전 수정' }, 3);
    const projected = rendered.at(-1)![0];
    const deletePending = deleteAsset(
      projected.id,
      projected.aggregateVersion,
      projected
    );
    expect(mockedCommands.deleteAsset).not.toHaveBeenCalled();

    updateCommand.resolve();
    await updatePending;
    await flushPromises();
    expect(mockedCommands.deleteAsset).toHaveBeenCalledWith(
      'house-1',
      'asset-1',
      4
    );
    await deletePending;
    unsubscribe();
  });

  test('position quote-only 갱신은 quantity 변경과 충돌하지 않고 최신 version으로 이어 붙인다', async () => {
    const unsubscribe = subscribeToHouseholdStockHoldings(() => undefined);
    const { next } = listenerArguments();
    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(stockHolding())],
    });
    const mismatch = Object.assign(
      new Error('position conflict'),
      { code: 'POSITION_VERSION_MISMATCH' }
    );
    mockedCommands.updatePosition
      .mockRejectedValueOnce(mismatch)
      .mockResolvedValueOnce(undefined);

    const base = stockHolding();
    const pending = updateStockHolding(
      base.id,
      base.assetId,
      { quantity: 11 },
      base.aggregateVersion,
      base
    );
    await flushPromises();
    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(stockHolding({
        aggregateVersion: 4,
        currentPrice: 81_000,
      }))],
    });
    await pending;

    expect(mockedCommands.updatePosition).toHaveBeenLastCalledWith(
      'house-1',
      'stock',
      'stock-1',
      'asset-1',
      { quantity: 11 },
      4
    );
    expect(mockedCommands.updatePosition).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  test('position update 직후 delete도 같은 entity FIFO로 직렬화한다', async () => {
    const rendered: StockHolding[][] = [];
    const unsubscribe = subscribeToHouseholdStockHoldings(
      (items) => rendered.push(items)
    );
    const { next } = listenerArguments();
    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(stockHolding())],
    });
    const updateCommand = deferred<void>();
    mockedCommands.updatePosition.mockReturnValue(updateCommand.promise);

    const updatePending = updateStockHolding(
      'stock-1',
      'asset-1',
      { quantity: 11 },
      3
    );
    const projected = rendered.at(-1)![0];
    const deletePending = deleteStockHolding(
      projected.id,
      projected.assetId,
      projected.aggregateVersion,
      projected
    );
    expect(mockedCommands.deletePosition).not.toHaveBeenCalled();

    updateCommand.resolve();
    await updatePending;
    await flushPromises();
    expect(mockedCommands.deletePosition).toHaveBeenCalledWith(
      'house-1',
      'stock',
      'stock-1',
      'asset-1',
      4
    );
    await deletePending;
    unsubscribe();
  });

  test('메모 입력 뒤 즉시 삭제해도 같은 자산 FIFO에서 저장 성공 version으로 삭제한다', async () => {
    const rendered: Asset[][] = [];
    const unsubscribe = subscribeToAssets(
      (items) => rendered.push(items),
      [asset()]
    );
    const { next } = listenerArguments();
    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(asset())],
    });
    const updateCommand = deferred<void>();
    mockedCommands.updateAsset.mockReturnValue(updateCommand.promise);

    const updatePending = updateAsset(
      'asset-1',
      { memo: '출자금 메모' },
      3,
      asset()
    );
    const projected = rendered.at(-1)![0];
    const deletePending = deleteAsset(
      projected.id,
      projected.aggregateVersion,
      projected
    );

    expect(mockedCommands.deleteAsset).not.toHaveBeenCalled();
    updateCommand.resolve();
    await updatePending;
    await flushPromises();
    expect(mockedCommands.deleteAsset).toHaveBeenCalledWith(
      'house-1',
      'asset-1',
      4
    );
    await deletePending;
    unsubscribe();
  });

  test('메모 지움과 잔액 수정을 연속 저장한 뒤 삭제해도 모든 command를 FIFO로 보낸다', async () => {
    const initial = asset({ memo: '지울 메모' });
    const rendered: Asset[][] = [];
    const unsubscribe = subscribeToAssets(
      (items) => rendered.push(items),
      [initial]
    );
    const { next } = listenerArguments();
    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(initial)],
    });
    const clearMemoCommand = deferred<void>();
    const balanceCommand = deferred<void>();
    mockedCommands.updateAsset
      .mockReturnValueOnce(clearMemoCommand.promise)
      .mockReturnValueOnce(balanceCommand.promise);

    const clearMemoPending = updateAsset(
      'asset-1',
      { memo: '' },
      3,
      initial
    );
    const afterMemoClear = rendered.at(-1)![0];
    const balancePending = updateAsset(
      'asset-1',
      { currentBalance: 20_500_000 },
      afterMemoClear.aggregateVersion,
      afterMemoClear
    );
    const afterBalance = rendered.at(-1)![0];
    const deletePending = deleteAsset(
      'asset-1',
      afterBalance.aggregateVersion,
      afterBalance
    );

    await flushPromises();
    expect(mockedCommands.updateAsset).toHaveBeenCalledTimes(1);
    expect(mockedCommands.deleteAsset).not.toHaveBeenCalled();
    clearMemoCommand.resolve();
    await clearMemoPending;
    await flushPromises();
    expect(mockedCommands.updateAsset).toHaveBeenLastCalledWith(
      'house-1',
      'asset-1',
      { currentBalance: 20_500_000 },
      4
    );
    balanceCommand.resolve();
    await balancePending;
    await flushPromises();
    expect(mockedCommands.deleteAsset).toHaveBeenCalledWith(
      'house-1',
      'asset-1',
      5
    );
    await deletePending;
    unsubscribe();
  });

  test('오래 열린 폼의 시스템 자동화 필드는 보내지 않고 실제 메모 변경만 최신 자산에 rebase한다', async () => {
    const editBase = asset({
      memo: '기존 메모',
      lastAutoContributionMonth: '',
    });
    const latest = asset({
      aggregateVersion: 4,
      memo: '기존 메모',
      currentBalance: 20_100_000,
      lastAutoContributionMonth: '2026-07',
    });
    const unsubscribe = subscribeToAssets(() => undefined, [editBase]);
    const { next } = listenerArguments();
    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(latest)],
    });

    await updateAsset(
      editBase.id,
      {
        memo: '사용자 메모',
        currentBalance: editBase.currentBalance,
        lastAutoContributionMonth: latest.lastAutoContributionMonth,
      },
      editBase.aggregateVersion,
      editBase
    );

    expect(mockedCommands.updateAsset).toHaveBeenCalledWith(
      'house-1',
      editBase.id,
      { memo: '사용자 메모' },
      4
    );
    unsubscribe();
  });

  test('실물 금 시세가 갱신된 뒤 수량 저장은 파생 잔액을 포함해 최신 version에 rebase한다', async () => {
    const editBase = asset({
      type: 'gold',
      subType: '실물',
      quantity: 1,
      currentBalance: 500_000,
    });
    const latest = asset({
      type: 'gold',
      subType: '실물',
      aggregateVersion: 4,
      quantity: 1,
      currentBalance: 510_000,
    });
    const unsubscribe = subscribeToAssets(() => undefined, [editBase]);
    const { next } = listenerArguments();
    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(latest)],
    });

    await updateAsset(
      editBase.id,
      {
        quantity: 2,
        currentBalance: 1_020_000,
      },
      editBase.aggregateVersion,
      editBase
    );

    expect(mockedCommands.updateAsset).toHaveBeenCalledWith(
      'house-1',
      editBase.id,
      {
        quantity: 2,
        currentBalance: 1_020_000,
      },
      4
    );
    unsubscribe();
  });

  test('자산 update 뒤 reorder는 선행 command를 기다리고 최신 version floor를 보존한다', async () => {
    const first = asset();
    const second = asset({
      id: 'asset-2',
      name: '두 번째 자산',
      order: 1,
    });
    const rendered: Asset[][] = [];
    const unsubscribe = subscribeToAssets(
      (items) => rendered.push(items),
      [first, second]
    );
    const { next } = listenerArguments();
    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(first), snapshotAsset(second)],
    });
    const updateCommand = deferred<void>();
    mockedCommands.updateAsset.mockReturnValue(updateCommand.promise);

    const updatePending = updateAsset(first.id, { memo: '먼저 저장' }, 3, first);
    const reorderPending = updateAssetOrders([
      { id: second.id, order: 0 },
      { id: first.id, order: 1 },
    ]);
    expect(mockedCommands.reorderAssets).not.toHaveBeenCalled();

    updateCommand.resolve();
    await updatePending;
    await flushPromises();
    expect(mockedCommands.reorderAssets).toHaveBeenCalledWith(
      'house-1',
      [
        { id: second.id, order: 0 },
        { id: first.id, order: 1 },
      ]
    );
    await reorderPending;
    expect(rendered.at(-1)?.find(({ id }) => id === first.id)).toMatchObject({
      aggregateVersion: 5,
      memo: '먼저 저장',
      order: 1,
    });
    unsubscribe();
  });

  test('reorder 응답 전에 더 최신 snapshot이 와도 존재하지 않는 version floor를 만들지 않는다', async () => {
    const first = asset();
    const second = asset({
      id: 'asset-2',
      name: '두 번째 자산',
      order: 1,
    });
    const rendered: Asset[][] = [];
    const unsubscribe = subscribeToAssets(
      (items) => rendered.push(items),
      [first, second]
    );
    const { next } = listenerArguments();
    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(first), snapshotAsset(second)],
    });
    const reorderCommand = deferred<void>();
    mockedCommands.reorderAssets.mockReturnValue(reorderCommand.promise);

    const reorderPending = updateAssetOrders([
      { id: second.id, order: 0 },
      { id: first.id, order: 1 },
    ]);
    await flushPromises();

    // The reorder has already committed at version 4, and a separate update
    // advances the server to version 5 before the callable response arrives.
    next({
      metadata: { fromCache: false },
      docs: [
        snapshotAsset(first),
        snapshotAsset(second),
      ].map((_, index) => (
        index === 0
          ? snapshotAsset(asset({
              aggregateVersion: 5,
              order: 1,
              memo: '외부 갱신',
            }))
          : snapshotAsset(asset({
              id: second.id,
              name: second.name,
              aggregateVersion: 5,
              order: 0,
            }))
      )),
    });
    reorderCommand.resolve();
    await reorderPending;

    const latest = rendered.at(-1)!.find(({ id }) => id === first.id)!;
    expect(latest).toMatchObject({
      aggregateVersion: 5,
      order: 1,
      memo: '외부 갱신',
    });

    await updateAsset(
      first.id,
      { currentBalance: 21_000_000 },
      latest.aggregateVersion,
      latest
    );
    expect(mockedCommands.updateAsset).toHaveBeenLastCalledWith(
      'house-1',
      first.id,
      { currentBalance: 21_000_000 },
      5
    );
    unsubscribe();
  });

  test('reorder 직후 update와 delete도 reorder 성공 뒤 순서대로 실행한다', async () => {
    const first = asset();
    const second = asset({
      id: 'asset-2',
      name: '두 번째 자산',
      order: 1,
    });
    const rendered: Asset[][] = [];
    const unsubscribe = subscribeToAssets(
      (items) => rendered.push(items),
      [first, second]
    );
    const { next } = listenerArguments();
    next({
      metadata: { fromCache: false },
      docs: [snapshotAsset(first), snapshotAsset(second)],
    });
    const reorderCommand = deferred<void>();
    const updateCommand = deferred<void>();
    mockedCommands.reorderAssets.mockReturnValue(reorderCommand.promise);
    mockedCommands.updateAsset.mockReturnValue(updateCommand.promise);

    const reorderPending = updateAssetOrders([
      { id: second.id, order: 0 },
      { id: first.id, order: 1 },
    ]);
    const afterReorder = rendered.at(-1)!.find(({ id }) => id === first.id)!;
    const updatePending = updateAsset(
      first.id,
      { memo: '재정렬 뒤 메모' },
      afterReorder.aggregateVersion,
      afterReorder
    );
    const afterUpdate = rendered.at(-1)!.find(({ id }) => id === first.id)!;
    const deletePending = deleteAsset(
      first.id,
      afterUpdate.aggregateVersion,
      afterUpdate
    );
    expect(mockedCommands.updateAsset).not.toHaveBeenCalled();
    expect(mockedCommands.deleteAsset).not.toHaveBeenCalled();

    reorderCommand.resolve();
    await reorderPending;
    await flushPromises();
    expect(mockedCommands.updateAsset).toHaveBeenCalledWith(
      'house-1',
      first.id,
      { memo: '재정렬 뒤 메모' },
      4
    );
    updateCommand.resolve();
    await updatePending;
    await flushPromises();
    expect(mockedCommands.deleteAsset).toHaveBeenCalledWith(
      'house-1',
      first.id,
      5
    );
    await deletePending;
    unsubscribe();
  });
});

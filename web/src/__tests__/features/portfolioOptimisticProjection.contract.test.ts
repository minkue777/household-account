import { OptimisticEntityProjection } from '@/platform/read-model/optimisticEntityProjection';
import type { Asset, StockHolding } from '@/types/asset';

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
    aggregateVersion: 2,
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

describe('portfolio optimistic projection contract', () => {
  test('수정·삭제는 서버 응답 전 같은 tick에 반영되고 실패하면 최신 read model로 rollback된다', () => {
    const projection = new OptimisticEntityProjection<Asset>(
      'portfolio-test',
      (left, right) => left.order - right.order
    );
    const rendered: Asset[][] = [];
    const subscription = projection.subscribe((items) => rendered.push(items));
    subscription.publish([asset()]);

    const updateId = projection.beginUpdate('asset-1', { name: '새 이름' });
    expect(rendered.at(-1)?.[0].name).toBe('새 이름');

    subscription.publish([asset({ currentBalance: 1_200_000 })]);
    projection.rollback(updateId);
    expect(rendered.at(-1)?.[0]).toMatchObject({
      name: '예금',
      currentBalance: 1_200_000,
    });

    const deleteId = projection.beginDelete('asset-1');
    expect(rendered.at(-1)).toEqual([]);
    projection.rollback(deleteId);
    expect(rendered.at(-1)?.[0].id).toBe('asset-1');
  });

  test('성공한 수정은 느린 이전 snapshot에 덮어쓰이지 않고 동일 버전 snapshot에서 확정된다', () => {
    const projection = new OptimisticEntityProjection<Asset>(
      'portfolio-test',
      (left, right) => left.order - right.order
    );
    const rendered: Asset[][] = [];
    const subscription = projection.subscribe((items) => rendered.push(items));
    subscription.publish([asset()]);

    const mutationId = projection.beginUpdate('asset-1', { name: '확정 이름' });
    projection.commitUpdate(mutationId, asset({ aggregateVersion: 4, name: '확정 이름' }));
    subscription.publish([asset({ aggregateVersion: 3, name: '이전 이름' })]);
    expect(rendered.at(-1)?.[0]).toMatchObject({
      aggregateVersion: 4,
      name: '확정 이름',
    });

    subscription.publish([asset({ aggregateVersion: 4, name: '확정 이름' })]);
    expect(rendered.at(-1)?.[0]).toMatchObject({
      aggregateVersion: 4,
      name: '확정 이름',
    });
  });

  test('다중 구독의 모든 snapshot이 따라오기 전에는 수정·삭제 overlay를 조기 제거하지 않는다', () => {
    const projection = new OptimisticEntityProjection<Asset>(
      'portfolio-test',
      (left, right) => left.order - right.order
    );
    const firstRendered: Asset[][] = [];
    const secondRendered: Asset[][] = [];
    const first = projection.subscribe((items) => firstRendered.push(items));
    const second = projection.subscribe((items) => secondRendered.push(items));
    first.publish([asset()]);
    second.publish([asset()]);

    const updateId = projection.beginUpdate('asset-1', { name: '다중 구독 수정' });
    projection.commitUpdate(
      updateId,
      asset({ aggregateVersion: 4, name: '다중 구독 수정' })
    );
    first.publish([asset({ aggregateVersion: 4, name: '다중 구독 수정' })]);

    expect(secondRendered.at(-1)?.[0]).toMatchObject({
      aggregateVersion: 4,
      name: '다중 구독 수정',
    });

    second.publish([asset({ aggregateVersion: 4, name: '다중 구독 수정' })]);
    const deleteId = projection.beginDelete('asset-1');
    projection.commitDelete(deleteId);
    first.publish([]);

    expect(secondRendered.at(-1)).toEqual([]);
    second.publish([]);
    expect(firstRendered.at(-1)).toEqual([]);
  });

  test('보유 항목 추가는 해당 자산 구독에만 즉시 노출되고 실패 시 제거된다', () => {
    const projection = new OptimisticEntityProjection<StockHolding>(
      'stock-position-test',
      (left, right) => left.stockName.localeCompare(right.stockName, 'ko')
    );
    const firstAsset: StockHolding[][] = [];
    const secondAsset: StockHolding[][] = [];
    const first = projection.subscribe(
      (items) => firstAsset.push(items),
      (item) => item.assetId === 'asset-1'
    );
    const second = projection.subscribe(
      (items) => secondAsset.push(items),
      (item) => item.assetId === 'asset-2'
    );
    first.publish([]);
    second.publish([]);

    const mutationId = projection.beginCreate(holding());
    expect(firstAsset.at(-1)?.map(({ id }) => id)).toEqual(['position-1']);
    expect(secondAsset.at(-1)).toEqual([]);
    expect(projection.current('position-1')).toMatchObject({ assetId: 'asset-1' });

    projection.rollback(mutationId);
    expect(firstAsset.at(-1)).toEqual([]);
  });

  test('삭제 중 화면을 재진입해도 오래된 cache가 항목을 부활시키지 않는다', () => {
    const projection = new OptimisticEntityProjection<StockHolding>(
      'stock-position-test',
      (left, right) => left.stockName.localeCompare(right.stockName, 'ko')
    );
    const first = projection.subscribe(
      () => undefined,
      (item) => item.assetId === 'asset-1'
    );
    first.publish([holding()]);
    const mutationId = projection.beginDelete('position-1');
    first.dispose();
    projection.commitDelete(mutationId);

    const replacementRendered: StockHolding[][] = [];
    const replacement = projection.subscribe(
      (items) => replacementRendered.push(items),
      (item) => item.assetId === 'asset-1'
    );
    replacement.publish([holding()]);
    expect(replacementRendered.at(-1)).toEqual([]);

    replacement.publish([]);

    expect(() => projection.beginCreate(holding())).not.toThrow();
  });

  test('a first empty cache emission after resubscribe cannot confirm a committed delete', () => {
    const projection = new OptimisticEntityProjection<StockHolding>(
      'stock-position-test',
      (left, right) => left.stockName.localeCompare(right.stockName, 'ko')
    );
    const original = projection.subscribe(
      () => undefined,
      (item) => item.assetId === 'asset-1'
    );
    original.publish([holding()]);
    const mutationId = projection.beginDelete('position-1');
    original.dispose();
    projection.commitDelete(mutationId);

    const firstRoute = projection.subscribe(
      () => undefined,
      (item) => item.assetId === 'asset-1'
    );
    firstRoute.publish([]);
    firstRoute.dispose();

    const staleRouteRendered: StockHolding[][] = [];
    const staleRoute = projection.subscribe(
      (items) => staleRouteRendered.push(items),
      (item) => item.assetId === 'asset-1'
    );
    staleRoute.publish([holding()]);

    expect(staleRouteRendered.at(-1)).toEqual([]);
  });

  test('수정 후 화면을 재진입해도 서버 확정 전 이전 cache 값으로 되돌아가지 않는다', () => {
    const projection = new OptimisticEntityProjection<Asset>(
      'portfolio-test',
      (left, right) => left.order - right.order
    );
    const first = projection.subscribe(() => undefined);
    first.publish([asset()]);

    const mutationId = projection.beginUpdate('asset-1', { name: '확정 이름' });
    projection.commitUpdate(
      mutationId,
      asset({ aggregateVersion: 4, name: '확정 이름' })
    );
    first.dispose();

    const replacementRendered: Asset[][] = [];
    const replacement = projection.subscribe((items) => replacementRendered.push(items));
    replacement.publish([asset({ aggregateVersion: 3, name: '이전 이름' })]);
    expect(replacementRendered.at(-1)?.[0]).toMatchObject({
      aggregateVersion: 4,
      name: '확정 이름',
    });

    replacement.publish([asset({ aggregateVersion: 4, name: '확정 이름' })]);
    expect(replacementRendered.at(-1)?.[0]).toMatchObject({
      aggregateVersion: 4,
      name: '확정 이름',
    });
  });

  test('an update that enters another query appears there before the server snapshot', () => {
    const projection = new OptimisticEntityProjection<Asset>(
      'portfolio-test',
      (left, right) => left.order - right.order
    );
    const savingsRendered: Asset[][] = [];
    const stockRendered: Asset[][] = [];
    const savings = projection.subscribe(
      (items) => savingsRendered.push(items),
      (item) => item.type === 'savings'
    );
    const stocks = projection.subscribe(
      (items) => stockRendered.push(items),
      (item) => item.type === 'stock'
    );
    savings.publish([asset()]);
    stocks.publish([]);

    projection.beginUpdate('asset-1', { type: 'stock' });

    expect(savingsRendered.at(-1)).toEqual([]);
    expect(stockRendered.at(-1)?.[0]).toMatchObject({
      id: 'asset-1',
      type: 'stock',
    });
  });

  test('a committed update remains projected until both source and destination queries confirm it', () => {
    const projection = new OptimisticEntityProjection<Asset>(
      'portfolio-test',
      (left, right) => left.order - right.order
    );
    const stockRendered: Asset[][] = [];
    const savings = projection.subscribe(
      () => undefined,
      (item) => item.type === 'savings'
    );
    const stocks = projection.subscribe(
      (items) => stockRendered.push(items),
      (item) => item.type === 'stock'
    );
    savings.publish([asset()]);
    stocks.publish([]);

    const mutationId = projection.beginUpdate('asset-1', { type: 'stock' });
    const canonical = asset({ aggregateVersion: 4, type: 'stock' });
    projection.commitUpdate(mutationId, canonical);
    savings.publish([]);
    stocks.publish([]);

    expect(stockRendered.at(-1)).toEqual([canonical]);
    expect(projection.current('asset-1')).toEqual(canonical);

    stocks.publish([canonical]);
    expect(stockRendered.at(-1)).toEqual([canonical]);
  });

  test('a source-query removal alone cannot discard a committed move before the destination observes it', () => {
    const projection = new OptimisticEntityProjection<Asset>(
      'portfolio-test',
      (left, right) => left.order - right.order
    );
    const savings = projection.subscribe(
      () => undefined,
      (item) => item.type === 'savings'
    );
    savings.publish([asset()]);

    const mutationId = projection.beginUpdate('asset-1', { type: 'stock' });
    const canonical = asset({ aggregateVersion: 4, type: 'stock' });
    projection.commitUpdate(mutationId, canonical);

    // The source query correctly removes the moved entity before the destination route exists.
    savings.publish([]);
    savings.dispose();

    const destinationRendered: Asset[][] = [];
    const stocks = projection.subscribe(
      (items) => destinationRendered.push(items),
      (item) => item.type === 'stock'
    );
    // A route may first receive an old persistent-cache snapshot.
    stocks.publish([]);
    expect(destinationRendered.at(-1)).toEqual([canonical]);

    // The authoritative destination snapshot then confirms and owns the value.
    stocks.publish([canonical]);
    expect(destinationRendered.at(-1)).toEqual([canonical]);
  });

  test('a second command may start after the first response while its snapshot is still pending', () => {
    const projection = new OptimisticEntityProjection<Asset>(
      'portfolio-test',
      (left, right) => left.order - right.order
    );
    const rendered: Asset[][] = [];
    const subscription = projection.subscribe((items) => rendered.push(items));
    subscription.publish([asset()]);

    const firstId = projection.beginUpdate('asset-1', { name: 'first committed name' });
    projection.commitUpdate(
      firstId,
      asset({ aggregateVersion: 4, name: 'first committed name' })
    );

    const secondId = projection.beginUpdate('asset-1', { currentBalance: 2_000_000 });
    expect(rendered.at(-1)?.[0]).toMatchObject({
      aggregateVersion: 4,
      name: 'first committed name',
      currentBalance: 2_000_000,
    });

    projection.rollback(secondId);
    expect(rendered.at(-1)?.[0]).toMatchObject({
      aggregateVersion: 4,
      name: 'first committed name',
      currentBalance: 1_000_000,
    });
  });

  test('a delete after a committed create does not resurrect from an older empty snapshot', () => {
    const projection = new OptimisticEntityProjection<Asset>(
      'portfolio-test',
      (left, right) => left.order - right.order
    );
    const rendered: Asset[][] = [];
    const subscription = projection.subscribe((items) => rendered.push(items));
    subscription.publish([]);

    const createId = projection.beginCreate(asset({ aggregateVersion: 1 }));
    projection.commitCreate(createId, asset({ aggregateVersion: 1 }));
    const deleteId = projection.beginDelete('asset-1');
    projection.commitDelete(deleteId);

    expect(rendered.at(-1)).toEqual([]);

    subscription.publish([]);
    expect(rendered.at(-1)).toEqual([]);
    expect(projection.current('asset-1')).toBeUndefined();
  });
});

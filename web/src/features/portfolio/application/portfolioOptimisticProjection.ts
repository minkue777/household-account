import { OptimisticEntityProjection } from '@/platform/read-model/optimisticEntityProjection';
import type { Asset, CryptoHolding, StockHolding } from '@/types/asset';

function compareAssets(left: Asset, right: Asset): number {
  return left.order - right.order || left.name.localeCompare(right.name, 'ko');
}

export class PortfolioOptimisticProjection {
  private readonly projection = new OptimisticEntityProjection<Asset>(
    'portfolio',
    compareAssets
  );

  subscribe(callback: (assets: Asset[]) => void, householdId?: string) {
    return this.projection.subscribe(
      callback,
      householdId === undefined ? undefined : (asset) => asset.householdId === householdId
    );
  }

  current(assetId: string): Asset | undefined {
    return this.projection.current(assetId);
  }

  beginUpdate(assetId: string, changes: Partial<Asset>): string {
    return this.projection.beginUpdate(assetId, changes);
  }

  beginCreate(asset: Asset): string {
    return this.projection.beginCreate(asset);
  }

  beginDelete(assetId: string): string {
    return this.projection.beginDelete(assetId);
  }

  commitUpdate(mutationId: string, canonical: Asset): void {
    this.projection.commitUpdate(mutationId, canonical);
  }

  commitCreate(mutationId: string, canonical: Asset): void {
    this.projection.commitCreate(mutationId, canonical);
  }

  commitDelete(mutationId: string): void {
    this.projection.commitDelete(mutationId);
  }

  rollback(mutationId: string): void {
    this.projection.rollback(mutationId);
  }

  reset(): void {
    this.projection.reset();
  }
}

export const portfolioOptimisticProjection = new PortfolioOptimisticProjection();

function compareStockHoldings(left: StockHolding, right: StockHolding): number {
  return left.stockName.localeCompare(right.stockName, 'ko');
}

function compareCryptoHoldings(left: CryptoHolding, right: CryptoHolding): number {
  return left.coinName.localeCompare(right.coinName, 'ko');
}

export const stockHoldingOptimisticProjection =
  new OptimisticEntityProjection<StockHolding>('stock-position', compareStockHoldings);

export const cryptoHoldingOptimisticProjection =
  new OptimisticEntityProjection<CryptoHolding>('crypto-position', compareCryptoHoldings);

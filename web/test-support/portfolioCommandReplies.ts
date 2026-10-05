import { registerClientSessionReset } from '@/composition/clientSessionResetRegistry';
import type { Asset, AssetInput, StockHolding, StockHoldingInput, CryptoHolding, CryptoHoldingInput } from '@/types/asset';
import type { PortfolioCommandConfirmation, PortfolioConfirmedAsset, PortfolioConfirmedPosition, PortfolioMutationResult } from '@/platform/functions-api/portfolioCommandResult';
import { portfolioOptimisticProjection, stockHoldingOptimisticProjection, cryptoHoldingOptimisticProjection } from '@/features/portfolio/application/portfolioOptimisticProjection';

const assetSources = new Map<string, Asset>();
const positions = new Map<string, StockHolding | CryptoHolding>();
export function resetReplySources(): void { assetSources.clear(); positions.clear(); }
registerClientSessionReset(resetReplySources);
export function replySource<T extends Asset | StockHolding | CryptoHolding>(value: T): T {
  const sources = 'assetId' in value ? positions : assetSources;
  const previous = sources.get(value.id);
  if (!previous || previous.aggregateVersion <= value.aggregateVersion) {
    if ('assetId' in value) positions.set(value.id, value);
    else assetSources.set(value.id, value);
  }
  return value;
}

// 지연/세션 테스트용 wire DTO 작성기입니다. 정규화·평가·version 경합은 실제 서버 SDK 검사에서 검증합니다.
export function assetView(asset: Asset): PortfolioConfirmedAsset {
  return { assetId: asset.id, householdId: asset.householdId, name: asset.name, type: asset.type, subType: asset.subType,
    ownerRef: asset.ownerRef ?? { kind: 'household' }, currency: asset.currency as 'KRW' | 'USD', currentBalance: asset.currentBalance,
    costBasis: asset.costBasis, memo: asset.memo ?? '', order: asset.order, lifecycleState: asset.isActive ? 'active' : 'deleted',
    aggregateVersion: asset.aggregateVersion, initialInvestment: asset.initialInvestment, quantity: asset.quantity,
    stockCode: asset.stockCode, icon: asset.icon, color: asset.color,
    automation: { recurringContributionAmount: asset.recurringContributionAmount ?? 0, recurringContributionDay: asset.recurringContributionDay ?? 0,
      lastAutoContributionMonth: asset.lastAutoContributionMonth ?? '', loanInterestRate: asset.loanInterestRate ?? 0,
      loanRepaymentMethod: asset.loanRepaymentMethod ?? '', loanMonthlyPaymentAmount: asset.loanMonthlyPaymentAmount ?? 0,
      loanPaymentDay: asset.loanPaymentDay ?? 0, lastAutoRepaymentMonth: asset.lastAutoRepaymentMonth ?? '' } };
}
export function positionView(position: StockHolding | CryptoHolding, kind: 'stock' | 'crypto'): PortfolioConfirmedPosition {
  const stock = position as StockHolding, crypto = position as CryptoHolding;
  return { positionId: position.id, assetId: position.assetId, householdId: position.householdId, positionKind: kind,
    instrumentCode: kind === 'stock' ? stock.stockCode ?? '' : crypto.marketCode,
    instrumentName: kind === 'stock' ? stock.stockName : crypto.coinName,
    instrumentType: kind === 'stock' ? stock.instrumentType ?? 'stock' : 'crypto', market: kind === 'stock' ? stock.market ?? 'KRX' : 'UPBIT_KRW',
    currency: 'KRW', holdingType: kind === 'stock' ? stock.holdingType ?? 'stock' : undefined,
    quantity: position.quantity, averagePriceInWon: position.avgPrice ?? 0, priceScale: stock.priceScale ?? 1,
    ...(position.currentPrice === undefined ? {} : { lastQuote: { priceInWon: position.currentPrice, provider: 'test-provider', observedAt: '2026-07-22T00:00:00Z' } }),
    aggregateVersion: position.aggregateVersion, lifecycleState: 'active' };
}
export function confirmedReply(assets: PortfolioConfirmedAsset[] = [], positions: PortfolioConfirmedPosition[] = []): PortfolioMutationResult {
  const confirmation: PortfolioCommandConfirmation = { schemaVersion: 1, occurredAt: '2026-07-22T00:00:00Z', assets, positions };
  return { confirmation };
}

export const portfolioReplies = {
  updateAsset(_householdId: string, id: string, changes: Partial<Asset>, version: number) {
    const base = assetSources.get(id) ?? portfolioOptimisticProjection.current(id);
    if (!base) throw new Error('TEST_ASSET_REQUIRED');
    return confirmedReply([assetView(replySource({ ...base, ...changes, aggregateVersion: version + 1 }))]);
  },
  reorderAssets(_householdId: string, assets: readonly { id: string; order: number }[], versions: Record<string, number>) {
    return confirmedReply(assets.map(({ id, order }) => {
      const base = assetSources.get(id) ?? portfolioOptimisticProjection.current(id);
      if (!base) throw new Error('TEST_ASSET_REQUIRED');
      return assetView(replySource({ ...base, order, aggregateVersion: versions[id] + 1 }));
    }));
  },
  updatePosition(_householdId: string, kind: 'stock' | 'crypto', id: string, _assetId: string, changes: Partial<StockHolding> | Partial<CryptoHolding>, version: number, _assetVersion: number) {
    const base = positions.get(id) ?? (kind === 'stock' ? stockHoldingOptimisticProjection : cryptoHoldingOptimisticProjection).current(id);
    if (!base) throw new Error('TEST_POSITION_REQUIRED');
    return confirmedReply([], [positionView(replySource({ ...base, ...changes, aggregateVersion: version + 1 }), kind)]);
  },
  deleteAsset(..._args: unknown[]) { return {}; },
  deletePosition(..._args: unknown[]) { return {}; },
  createAsset(householdId: string, input: AssetInput, commandId?: string) {
    const assetId = `asset-${householdId}-${commandId}`;
    const base = portfolioOptimisticProjection.current(assetId)!;
    return { assetId, ...confirmedReply([assetView({ ...base, ...input, aggregateVersion: 1 })]) };
  },
  addPosition(householdId: string, kind: 'stock' | 'crypto', input: StockHoldingInput | CryptoHoldingInput, commandId: string | undefined, _assetVersion: number) {
    const positionId = `position-${householdId}-${commandId}`;
    const base = (kind === 'stock' ? stockHoldingOptimisticProjection : cryptoHoldingOptimisticProjection).current(positionId)!;
    return { positionId, ...confirmedReply([], [positionView({ ...base, ...input, aggregateVersion: 1 }, kind)]) };
  },
};

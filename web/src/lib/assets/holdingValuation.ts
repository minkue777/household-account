import type { StockHolding } from '@/types/asset';

type HoldingValuationInput = Pick<
  StockHolding,
  'quantity' | 'currentPrice' | 'avgPrice' | 'priceScale'
>;

export function getHoldingPriceScale(holding: Pick<StockHolding, 'priceScale'>) {
  const priceScale = holding.priceScale;
  return typeof priceScale === 'number' && Number.isFinite(priceScale) && priceScale > 0
    ? priceScale
    : 1;
}

export function calculateHoldingValue(holding: HoldingValuationInput) {
  const price = holding.currentPrice || holding.avgPrice || 0;
  return (price * holding.quantity) / getHoldingPriceScale(holding);
}

export function calculateHoldingCostBasis(holding: HoldingValuationInput) {
  return ((holding.avgPrice || 0) * holding.quantity) / getHoldingPriceScale(holding);
}

export function calculateHoldingProfitLoss(holding: HoldingValuationInput) {
  if (!holding.currentPrice || !holding.avgPrice) {
    return 0;
  }

  return (
    ((holding.currentPrice - holding.avgPrice) * holding.quantity) /
    getHoldingPriceScale(holding)
  );
}

export function isFundHolding(
  holding: Pick<StockHolding, 'instrumentType' | 'stockCode'>
) {
  return holding.instrumentType === 'fund' || holding.stockCode.startsWith('FUND:');
}

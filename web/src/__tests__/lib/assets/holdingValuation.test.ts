import {
  calculateHoldingCostBasis,
  calculateHoldingProfitLoss,
  calculateHoldingValue,
} from '@/lib/assets/holdingValuation';

describe('holdingValuation', () => {
  it('기존 주식은 수량과 가격을 그대로 곱한다', () => {
    const holding = {
      quantity: 10,
      avgPrice: 90_000,
      currentPrice: 100_000,
    };

    expect(calculateHoldingValue(holding)).toBe(1_000_000);
    expect(calculateHoldingCostBasis(holding)).toBe(900_000);
    expect(calculateHoldingProfitLoss(holding)).toBe(100_000);
  });

  it('펀드는 보유좌수와 1,000좌당 기준가로 평가한다', () => {
    const holding = {
      quantity: 30_000_000,
      avgPrice: 1_000,
      currentPrice: 1_001.19,
      priceScale: 1_000,
    };

    expect(calculateHoldingValue(holding)).toBeCloseTo(30_035_700);
    expect(calculateHoldingCostBasis(holding)).toBe(30_000_000);
    expect(calculateHoldingProfitLoss(holding)).toBeCloseTo(35_700);
  });

  it('잘못된 가격 단위는 기존 종목과 동일하게 1로 처리한다', () => {
    expect(
      calculateHoldingValue({
        quantity: 3,
        currentPrice: 5_000,
        priceScale: 0,
      })
    ).toBe(15_000);
  });
});

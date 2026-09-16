import { calculateHoldingValue, calculateHoldingProfitLoss } from '@/lib/assets/holdingValuation';

describe('화면 보유 평가 경계', () => {
  test('0원 시세는 원가로 대체하지 않고 손실을 표시한다', () => {
    const holding = { quantity: 10, avgPrice: 100, currentPrice: 0 };
    expect(calculateHoldingValue(holding)).toBe(0);
    expect(calculateHoldingProfitLoss(holding)).toBe(-1000);
  });
  test('시세 부재만 평균가로 대체하고 펀드 단위와 소수 시세를 보존한다', () => {
    expect(calculateHoldingValue({ quantity: 2, avgPrice: 0.49 })).toBe(0.98);
    expect(calculateHoldingValue({ quantity: 1000, avgPrice: 100, currentPrice: 100.49, priceScale: 1000 })).toBe(100.49);
  });
});

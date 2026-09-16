import { describe, expect, it } from "vitest";
import { calculateAccountValuation } from "../../../src/contexts/portfolio/holdings/public";
import { calculateHoldingValue, calculateHoldingCostBasis } from "../../../../web/src/lib/assets/holdingValuation";

interface ValuationPosition {
  positionId: string;
  kind: "stock" | "fund" | "crypto" | "cash";
  quantity: number;
  averagePrice: number;
  currentPrice?: number;
  priceScale: number;
}

interface AccountValuation {
  currentBalance: number;
  costBasis: number;
  positionAmounts: Readonly<Record<string, number>>;
}

export interface AccountValuationConsistencySubject {
  valueFromWebBoundary(
    positions: readonly ValuationPosition[],
  ): AccountValuation;
  valueFromScheduledJobBoundary(
    positions: readonly ValuationPosition[],
  ): AccountValuation;
}

export function createSubject(): AccountValuationConsistencySubject {
  return {
    valueFromWebBoundary: positions => {
      const holdings = positions.map(position => ({ ...position, avgPrice: position.averagePrice }));
      return {
        currentBalance: Math.round(holdings.reduce((total, holding) => total + calculateHoldingValue(holding), 0)),
        costBasis: Math.round(holdings.reduce((total, holding) => total + calculateHoldingCostBasis(holding), 0)),
        positionAmounts: Object.fromEntries(holdings.map(holding => [holding.positionId, calculateHoldingValue(holding)])),
      };
    },
    valueFromScheduledJobBoundary: calculateAccountValuation,
  };
}

describe("Web·예약 작업 공통 계좌 평가 Policy 계약", () => {
  it("0원 시세와 시세 부재를 구분하고 소수 평가액은 계좌 합계에서만 반올림한다", () => {
    const positions: readonly ValuationPosition[] = [
      { positionId: "zero", kind: "stock", quantity: 10, averagePrice: 100, currentPrice: 0, priceScale: 1 },
      { positionId: "missing", kind: "crypto", quantity: 2, averagePrice: 0.49, priceScale: 1 },
      { positionId: "fund", kind: "fund", quantity: 1000, averagePrice: 100, currentPrice: 100.49, priceScale: 1000 },
    ];
    const subject = createSubject();
    expect(subject.valueFromWebBoundary(positions)).toEqual(subject.valueFromScheduledJobBoundary(positions));
    expect(subject.valueFromWebBoundary(positions)).toMatchObject({ currentBalance: 101, positionAmounts: { zero: 0, missing: 0.98, fund: 100.49 } });
  });

  it("[T-HOLD-002][HOLD-003] 같은 Position fixture는 진입 경계와 무관하게 동일한 평가액·원가를 만든다", () => {
    const positions: readonly ValuationPosition[] = [
      {
        positionId: "stock",
        kind: "stock",
        quantity: 10,
        averagePrice: 90,
        currentPrice: 100,
        priceScale: 1,
      },
      {
        positionId: "fund",
        kind: "fund",
        quantity: 30_000_000,
        averagePrice: 1_000,
        currentPrice: 1_001.19,
        priceScale: 1_000,
      },
      {
        positionId: "crypto",
        kind: "crypto",
        quantity: 1,
        averagePrice: 0.49,
        priceScale: 1,
      },
    ];
    const subject = createSubject();

    const web = subject.valueFromWebBoundary(positions);
    const scheduled = subject.valueFromScheduledJobBoundary(positions);

    expect(web).toEqual(scheduled);
    expect(web).toEqual({
      currentBalance: 30_036_700,
      costBasis: 30_000_900,
      positionAmounts: {
        stock: 1_000,
        fund: 30_035_700,
        crypto: 0.49,
      },
    });
  });
});

export interface ValuationPosition {
  positionId: string;
  kind:
    | "stock"
    | "etf"
    | "etn"
    | "fund"
    | "cash"
    | "manual"
    | "crypto"
    | "physical-gold";
  quantity: number;
  averagePrice: number;
  currentPrice?: number;
  priceScale: number;
}

export interface PositionAmounts {
  evaluatedPrice: number;
  evaluatedAmount: number;
  costBasis: number;
}

export interface AccountValuation {
  currentBalance: number;
  costBasis: number;
  positionAmounts: Readonly<Record<string, number>>;
}

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field}는 유한한 0 이상의 수여야 합니다.`);
  }
}

export function calculatePositionAmountsPolicy(
  position: ValuationPosition,
): PositionAmounts {
  assertFiniteNonNegative(position.quantity, "quantity");
  assertFiniteNonNegative(position.averagePrice, "averagePrice");
  if (position.currentPrice !== undefined) {
    assertFiniteNonNegative(position.currentPrice, "currentPrice");
  }
  if (!Number.isFinite(position.priceScale) || position.priceScale <= 0) {
    throw new Error("priceScale은 유한한 양수여야 합니다.");
  }

  const evaluatedPrice = position.currentPrice ?? position.averagePrice;
  return {
    evaluatedPrice,
    evaluatedAmount:
      (position.quantity * evaluatedPrice) / position.priceScale,
    costBasis:
      (position.quantity * position.averagePrice) / position.priceScale,
  };
}

export function calculateAccountValuationPolicy(
  positions: readonly ValuationPosition[],
): AccountValuation {
  const positionAmounts: Record<string, number> = {};
  let currentBalance = 0;
  let costBasis = 0;

  for (const position of positions) {
    if (
      Object.prototype.hasOwnProperty.call(
        positionAmounts,
        position.positionId,
      )
    ) {
      throw new Error(`중복 Position ID입니다: ${position.positionId}`);
    }
    const amounts = calculatePositionAmountsPolicy(position);

    positionAmounts[position.positionId] = amounts.evaluatedAmount;
    currentBalance += amounts.evaluatedAmount;
    costBasis += amounts.costBasis;
  }

  return {
    currentBalance: Math.round(currentBalance),
    costBasis: Math.round(costBasis),
    positionAmounts,
  };
}

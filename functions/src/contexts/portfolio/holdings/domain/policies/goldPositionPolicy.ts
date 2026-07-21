import type {
  GoldPositionView,
  NormalizeGoldInput,
} from "../model/goldPosition";
import { calculatePositionAmountsPolicy } from "./accountValuation";

function legacyDonQuantity(memo: string | undefined): number | undefined {
  if (memo === undefined) return undefined;
  const match = /^\s*(\d+(?:\.\d+)?)\s*돈\s*$/.exec(memo);
  if (match === null) return undefined;
  const quantity = Number(match[1]);
  return Number.isFinite(quantity) ? quantity : undefined;
}

export function normalizeAndValueGold(
  input: NormalizeGoldInput,
): GoldPositionView {
  const normalizedQuantity = input.quantity ?? legacyDonQuantity(input.legacyMemo);
  if (
    normalizedQuantity === undefined ||
    !Number.isFinite(normalizedQuantity) ||
    normalizedQuantity < 0
  ) {
    throw new Error("유효한 금 수량이 필요합니다.");
  }
  const amounts = calculatePositionAmountsPolicy({
    positionId: input.positionId,
    kind: "physical-gold",
    quantity: normalizedQuantity,
    averagePrice: 0,
    currentPrice: input.quoteInWon,
    priceScale: 1,
  });
  return {
    positionId: input.positionId,
    kind: input.kind,
    normalizedQuantity,
    evaluatedAmountInWon: amounts.evaluatedAmount,
    quoteObservedAt: undefined,
  };
}

import type {
  HoldingAccountValuationResult,
  MarketResult,
  PositionValuation,
  PositionValuationInput,
  PositionValuationResult,
  RefreshedPositionResult,
} from "../model/holdingValuation";
import {
  calculateAccountValuationPolicy,
  calculatePositionAmountsPolicy,
} from "./accountValuation";

function validationError(
  input: PositionValuationInput,
): Extract<PositionValuationResult, { kind: "validation-error" }> | undefined {
  if (!Number.isFinite(input.quantity) || input.quantity < 0) {
    return { kind: "validation-error", code: "INVALID_QUANTITY" };
  }
  if (
    input.averagePrice !== undefined &&
    (!Number.isFinite(input.averagePrice) || input.averagePrice < 0)
  ) {
    return { kind: "validation-error", code: "INVALID_AVERAGE_PRICE" };
  }
  if (!Number.isFinite(input.priceScale) || input.priceScale <= 0) {
    return { kind: "validation-error", code: "INVALID_PRICE_SCALE" };
  }
  return undefined;
}

export function valueHoldingPosition(
  input: PositionValuationInput,
): PositionValuationResult {
  const invalid = validationError(input);
  if (invalid !== undefined) return invalid;

  const amounts = calculatePositionAmountsPolicy({
    positionId: input.positionId,
    kind: input.kind,
    quantity: input.quantity,
    averagePrice: input.averagePrice ?? 0,
    currentPrice: input.lastQuote?.priceInWon,
    priceScale: input.priceScale,
  });
  const value: PositionValuation = {
    positionId: input.positionId,
    evaluatedPriceSource:
      input.lastQuote === undefined ? "average-price" : "quote",
    evaluatedPriceInWon: amounts.evaluatedPrice,
    evaluatedAmountInWon: amounts.evaluatedAmount,
    costBasisInWon: amounts.costBasis,
    ...(input.lastQuote === undefined
      ? {}
      : { quoteObservedAt: input.lastQuote.observedAt }),
  };
  return { kind: "success", value };
}

export function refreshAndValueHoldingPosition(
  input: PositionValuationInput,
  marketResult: MarketResult,
): RefreshedPositionResult {
  if (marketResult.kind === "success") {
    const lastQuote = { ...marketResult.quote };
    const valued = valueHoldingPosition({ ...input, lastQuote });
    if (valued.kind !== "success") {
      throw new Error(`유효하지 않은 Position입니다: ${valued.code}`);
    }
    return { kind: "success", value: valued.value, lastQuote };
  }

  const valued = valueHoldingPosition(input);
  if (valued.kind !== "success") {
    throw new Error(`유효하지 않은 Position입니다: ${valued.code}`);
  }
  return {
    kind: "partial-failure",
    code: marketResult.code,
    retryable: marketResult.kind === "retryable-failure",
    value: valued.value,
    ...(input.lastQuote === undefined ? {} : { lastQuote: { ...input.lastQuote } }),
  };
}

export function valueHoldingAccount(
  inputs: readonly PositionValuationInput[],
): HoldingAccountValuationResult {
  for (const input of inputs) {
    const invalid = validationError(input);
    if (invalid !== undefined) return invalid;
  }
  try {
    const valuation = calculateAccountValuationPolicy(
      inputs.map((input) => ({
        positionId: input.positionId,
        kind: input.kind,
        quantity: input.quantity,
        averagePrice: input.averagePrice ?? 0,
        currentPrice: input.lastQuote?.priceInWon,
        priceScale: input.priceScale,
      })),
    );
    return {
      kind: "success",
      value: {
        currentBalance: valuation.currentBalance,
        costBasis: valuation.costBasis,
      },
    };
  } catch {
    return { kind: "validation-error", code: "INVALID_POSITION" };
  }
}

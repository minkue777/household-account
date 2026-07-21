export type ValueValidationResult<T> =
  | { readonly kind: "success"; readonly value: T }
  | { readonly kind: "validation-error"; readonly code: string };

export interface PositiveMoneyInWon {
  readonly amountInWon: number;
}

export function createPositiveMoneyInWon(
  value: unknown,
): ValueValidationResult<PositiveMoneyInWon> {
  if (typeof value !== "number") {
    return { kind: "validation-error", code: "MONEY_TYPE_INVALID" };
  }
  if (!Number.isInteger(value)) {
    return { kind: "validation-error", code: "MONEY_MUST_BE_INTEGER" };
  }
  if (!Number.isSafeInteger(value)) {
    return { kind: "validation-error", code: "MONEY_OUT_OF_SAFE_RANGE" };
  }
  if (value <= 0) {
    return { kind: "validation-error", code: "MONEY_MUST_BE_POSITIVE" };
  }
  return { kind: "success", value: { amountInWon: value } };
}

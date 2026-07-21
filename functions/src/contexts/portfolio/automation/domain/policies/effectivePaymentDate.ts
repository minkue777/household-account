import { daysInMonth, parseYearMonth } from "../value-objects/yearMonth";

export type EffectivePaymentDateResult =
  | { readonly kind: "success"; readonly effectiveDate: string }
  | {
      readonly kind: "validation-error";
      readonly code: "INVALID_TARGET_MONTH" | "INVALID_PAYMENT_DAY";
    };

export function calculateEffectivePaymentDatePolicy(
  targetMonth: string,
  configuredDay: number,
): EffectivePaymentDateResult {
  const yearMonth = parseYearMonth(targetMonth);
  if (!yearMonth) {
    return { kind: "validation-error", code: "INVALID_TARGET_MONTH" };
  }

  if (!Number.isInteger(configuredDay) || configuredDay < 1 || configuredDay > 31) {
    return { kind: "validation-error", code: "INVALID_PAYMENT_DAY" };
  }

  const effectiveDay = Math.min(configuredDay, daysInMonth(yearMonth));
  return {
    kind: "success",
    effectiveDate: `${targetMonth}-${String(effectiveDay).padStart(2, "0")}`,
  };
}

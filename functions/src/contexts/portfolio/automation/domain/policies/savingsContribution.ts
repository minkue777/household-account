import { calculateEffectivePaymentDatePolicy } from "./effectivePaymentDate";
import { parseLocalDate } from "../value-objects/localDate";

export interface SavingsContributionInput {
  readonly targetMonth: string;
  readonly configuredDay: number;
  readonly amount: number;
  readonly asOfDate: string;
}

export type SavingsContributionResult =
  | { readonly kind: "due"; readonly effectiveDate: string; readonly balanceDelta: number }
  | { readonly kind: "not-due"; readonly effectiveDate: string }
  | {
      readonly kind: "validation-error";
      readonly code:
        | "INVALID_AUTOMATION_AMOUNT"
        | "INVALID_PAYMENT_DAY"
        | "INVALID_TARGET_MONTH";
    };

export function evaluateSavingsContributionPolicy(
  input: SavingsContributionInput,
): SavingsContributionResult {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    return { kind: "validation-error", code: "INVALID_AUTOMATION_AMOUNT" };
  }

  const effectiveDate = calculateEffectivePaymentDatePolicy(
    input.targetMonth,
    input.configuredDay,
  );
  if (effectiveDate.kind === "validation-error") {
    return effectiveDate;
  }

  if (!parseLocalDate(input.asOfDate)) {
    return { kind: "validation-error", code: "INVALID_TARGET_MONTH" };
  }

  if (input.asOfDate < effectiveDate.effectiveDate) {
    return { kind: "not-due", effectiveDate: effectiveDate.effectiveDate };
  }

  return {
    kind: "due",
    effectiveDate: effectiveDate.effectiveDate,
    balanceDelta: input.amount,
  };
}

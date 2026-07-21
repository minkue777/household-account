import { calculateEffectivePaymentDatePolicy } from "./effectivePaymentDate";
import { parseLocalDate } from "../value-objects/localDate";
import { nextYearMonth } from "../value-objects/yearMonth";

export interface FirstAutomationMonthInput {
  readonly assetCreatedOn: string;
  readonly firstActivatedOn: string;
  readonly configuredDay: number;
}

export type FirstAutomationMonthResult =
  | {
      readonly kind: "success";
      readonly activationMonthDisposition: "included" | "applicable";
      readonly firstApplicableMonth: string;
      readonly activationMonthExecution?: {
        readonly targetMonth: string;
        readonly balanceDelta: 0;
        readonly reason: "included-in-current-balance";
      };
    }
  | {
      readonly kind: "validation-error";
      readonly code: "INVALID_TARGET_MONTH" | "INVALID_PAYMENT_DAY";
    };

export function firstMonthForInitialActivationPolicy(
  input: FirstAutomationMonthInput,
): FirstAutomationMonthResult {
  const firstActivatedOn = parseLocalDate(input.firstActivatedOn);
  if (!firstActivatedOn) {
    return { kind: "validation-error", code: "INVALID_TARGET_MONTH" };
  }

  const activationMonth = firstActivatedOn.yearMonth.value;
  const effectiveDate = calculateEffectivePaymentDatePolicy(
    activationMonth,
    input.configuredDay,
  );
  if (effectiveDate.kind === "validation-error") {
    return effectiveDate;
  }

  if (firstActivatedOn.value <= effectiveDate.effectiveDate) {
    return {
      kind: "success",
      activationMonthDisposition: "applicable",
      firstApplicableMonth: activationMonth,
    };
  }

  return {
    kind: "success",
    activationMonthDisposition: "included",
    firstApplicableMonth: nextYearMonth(firstActivatedOn.yearMonth),
    activationMonthExecution: {
      targetMonth: activationMonth,
      balanceDelta: 0,
      reason: "included-in-current-balance",
    },
  };
}

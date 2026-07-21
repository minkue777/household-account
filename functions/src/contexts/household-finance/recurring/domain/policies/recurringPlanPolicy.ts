import type { RecurringPlan } from "../model/recurringPlan";
import {
  isValidRecurringRequestedDay,
  resolveFirstApplicableMonth,
} from "./recurringSchedule";

export type RecurringPlanValidationResult<T> =
  | { kind: "valid"; value: T }
  | { kind: "validation-error"; code: string };

export interface NormalizedRecurringPlanFields {
  merchant: string;
  amountInWon: number;
  categoryId: string;
  dayOfMonth: number;
  memo: string;
  active: boolean;
}

function containsCreatorField(value: object): boolean {
  return (
    Object.prototype.hasOwnProperty.call(value, "creatorMemberId") ||
    ("patch" in value &&
      typeof value.patch === "object" &&
      value.patch !== null &&
      Object.prototype.hasOwnProperty.call(value.patch, "creatorMemberId"))
  );
}

export function rejectsCreatorInjection(operation: object): boolean {
  return containsCreatorField(operation);
}

function validateFields(
  fields: NormalizedRecurringPlanFields,
): RecurringPlanValidationResult<NormalizedRecurringPlanFields> {
  if (fields.merchant.length === 0) {
    return { kind: "validation-error", code: "MERCHANT_REQUIRED" };
  }
  if (!Number.isInteger(fields.amountInWon) || fields.amountInWon <= 0) {
    return {
      kind: "validation-error",
      code: "AMOUNT_NOT_POSITIVE_INTEGER",
    };
  }
  if (!isValidRecurringRequestedDay(fields.dayOfMonth)) {
    return { kind: "validation-error", code: "DAY_OUT_OF_RANGE" };
  }
  return { kind: "valid", value: fields };
}

export function normalizeCreateFields(input: {
  merchant: string;
  amountInWon: number;
  categoryId: string;
  dayOfMonth: number;
  memo?: string;
  active: boolean;
}): RecurringPlanValidationResult<NormalizedRecurringPlanFields> {
  return validateFields({
    merchant: input.merchant.trim(),
    amountInWon: input.amountInWon,
    categoryId: input.categoryId.trim(),
    dayOfMonth: input.dayOfMonth,
    memo: input.memo?.trim() ?? "",
    active: input.active,
  });
}

export function normalizeUpdatedFields(
  current: RecurringPlan,
  patch: Partial<
    Pick<
      RecurringPlan,
      | "merchant"
      | "amountInWon"
      | "categoryId"
      | "dayOfMonth"
      | "memo"
      | "active"
    >
  >,
): RecurringPlanValidationResult<NormalizedRecurringPlanFields> {
  return validateFields({
    merchant: (patch.merchant ?? current.merchant).trim(),
    amountInWon: patch.amountInWon ?? current.amountInWon,
    categoryId: (patch.categoryId ?? current.categoryId).trim(),
    dayOfMonth: patch.dayOfMonth ?? current.dayOfMonth,
    memo: (patch.memo ?? current.memo).trim(),
    active: patch.active ?? current.active,
  });
}

export function firstApplicableMonth(input: {
  localCreatedOn: string;
  dayOfMonth: number;
}): RecurringPlanValidationResult<string> {
  const result = resolveFirstApplicableMonth({
    createdOn: input.localCreatedOn,
    requestedDay: input.dayOfMonth,
  });
  return result.kind === "success"
    ? { kind: "valid", value: result.yearMonth }
    : {
        kind: "validation-error",
        code:
          result.code === "INVALID_RECURRING_DAY"
            ? "DAY_OUT_OF_RANGE"
            : "INVALID_CLOCK_DATE",
      };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = stableValue((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }
  return value;
}

export function recurringCommandPayloadSignature(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

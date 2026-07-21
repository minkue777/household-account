import type {
  AssetAutomationRestorationResult,
  AssetAutomationRestorationState,
  DueMonthsResult,
} from "../model/assetAutomationRestoration";
import { parseLocalDate } from "../value-objects/localDate";
import { nextYearMonth, parseYearMonth } from "../value-objects/yearMonth";
import { calculateEffectivePaymentDatePolicy } from "./effectivePaymentDate";

function normalizedLocalDate(value: string): string | undefined {
  const candidate = value.length >= 10 ? value.slice(0, 10) : value;
  return parseLocalDate(candidate)?.value;
}

function effectiveDate(
  targetMonth: string,
  configuredDay: number,
): string | undefined {
  const result = calculateEffectivePaymentDatePolicy(targetMonth, configuredDay);
  return result.kind === "success" ? result.effectiveDate : undefined;
}

function nextEffectiveDate(month: string, configuredDay: number): string | undefined {
  const parsed = parseYearMonth(month);
  return parsed === undefined
    ? undefined
    : effectiveDate(nextYearMonth(parsed), configuredDay);
}

export function prepareAssetAutomationRestorationPolicy(input: {
  readonly assetId: string;
  readonly deletedAt?: string;
  readonly restoredOn: string;
  readonly state?: AssetAutomationRestorationState;
}): AssetAutomationRestorationResult {
  if (input.state === undefined) {
    return { kind: "prepared" };
  }
  if (input.state.assetId !== input.assetId) {
    return { kind: "validation-error", code: "AUTOMATION_ASSET_MISMATCH" };
  }

  const deletedOn =
    input.deletedAt === undefined
      ? undefined
      : normalizedLocalDate(input.deletedAt);
  const restoredOn = normalizedLocalDate(input.restoredOn);
  if (deletedOn === undefined) {
    return {
      kind: "validation-error",
      code: "ASSET_DELETION_DATE_REQUIRED_FOR_AUTOMATION_RESTORE",
    };
  }
  if (restoredOn === undefined) {
    return { kind: "validation-error", code: "INVALID_RESTORED_ON" };
  }
  if (restoredOn < deletedOn) {
    return { kind: "validation-error", code: "RESTORE_DATE_BEFORE_DELETION" };
  }

  const currentMonth = restoredOn.slice(0, 7);
  const currentEffectiveDate = effectiveDate(
    currentMonth,
    input.state.configuredDay,
  );
  if (currentEffectiveDate === undefined) {
    return { kind: "validation-error", code: "INVALID_PAYMENT_DAY" };
  }
  const resumeFromDate =
    restoredOn <= currentEffectiveDate
      ? currentEffectiveDate
      : nextEffectiveDate(currentMonth, input.state.configuredDay);
  if (resumeFromDate === undefined) {
    return { kind: "validation-error", code: "INVALID_PAYMENT_DAY" };
  }

  const nextRevision =
    input.state.resumeRevisions.reduce(
      (maximum, revision) => Math.max(maximum, revision.revision),
      0,
    ) + 1;
  return {
    kind: "prepared",
    resumeFromDate,
    nextState: {
      ...input.state,
      pendingMonths: [...input.state.pendingMonths],
      suspensionIntervals: [
        ...input.state.suspensionIntervals,
        { startsOn: deletedOn, endsBefore: restoredOn },
      ],
      resumeRevisions: [
        ...input.state.resumeRevisions,
        { revision: nextRevision, restoredOn, resumeFromDate },
      ],
    },
  };
}

function isSuspended(
  state: AssetAutomationRestorationState,
  effectiveOn: string,
): boolean {
  return state.suspensionIntervals.some(
    ({ startsOn, endsBefore }) =>
      startsOn <= effectiveOn && effectiveOn < endsBefore,
  );
}

export function listDueMonthsPolicy(input: {
  readonly state?: AssetAutomationRestorationState;
  readonly assetLifecycle: "active" | "deleted" | "purging";
  readonly asOfDate: string;
}): DueMonthsResult {
  const asOfDate = normalizedLocalDate(input.asOfDate);
  if (asOfDate === undefined) {
    return { kind: "validation-error", code: "INVALID_AS_OF_DATE" };
  }
  if (input.state === undefined) {
    return { kind: "success", months: [] };
  }

  const dueMonths = new Set<string>();
  for (const month of input.state.pendingMonths) {
    const dueDate = effectiveDate(month, input.state.configuredDay);
    if (
      dueDate !== undefined &&
      dueDate <= asOfDate &&
      !isSuspended(input.state, dueDate)
    ) {
      dueMonths.add(month);
    }
  }

  if (input.assetLifecycle !== "active") {
    return { kind: "success", months: [...dueMonths].sort() };
  }
  const latestRevision =
    input.state.resumeRevisions[input.state.resumeRevisions.length - 1];
  if (latestRevision === undefined) {
    return { kind: "success", months: [...dueMonths].sort() };
  }

  let month = latestRevision.resumeFromDate.slice(0, 7);
  const lastMonth = asOfDate.slice(0, 7);
  while (month <= lastMonth) {
    const dueDate = effectiveDate(month, input.state.configuredDay);
    if (dueDate === undefined) {
      return { kind: "validation-error", code: "INVALID_PAYMENT_DAY" };
    }
    if (dueDate <= asOfDate && !isSuspended(input.state, dueDate)) {
      dueMonths.add(month);
    }
    const parsed = parseYearMonth(month);
    if (parsed === undefined) {
      return { kind: "validation-error", code: "INVALID_TARGET_MONTH" };
    }
    month = nextYearMonth(parsed);
  }
  return { kind: "success", months: [...dueMonths].sort() };
}

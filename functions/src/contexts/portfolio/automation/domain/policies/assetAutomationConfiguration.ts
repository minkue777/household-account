import { parseYearMonth, nextYearMonth } from "../value-objects/yearMonth";
import type { AssetAutomationSubject, AssetAutomationPlan } from "../model/assetAutomationConfiguration";
import { normalizeLoanRepaymentMethod } from "../value-objects/loanRepaymentMethod";
import { calculateEffectivePaymentDatePolicy } from "./effectivePaymentDate";
import { firstMonthForInitialActivationPolicy } from "./firstAutomationMonth";

function followingMonth(value: string): string | undefined {
  const parsed = parseYearMonth(value);
  return parsed === undefined ? undefined : nextYearMonth(parsed);
}

function seoulDate(instant: string): string {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) return instant.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

export function validateAutomationConfiguration(
  asset: AssetAutomationSubject,
): string | undefined {
  const automation = asset.automation;
  const hasSavingsConfiguration =
    automation.recurringContributionAmount > 0 ||
    automation.recurringContributionDay > 0;
  if (
    hasSavingsConfiguration &&
    (asset.type !== "savings" || asset.subType !== "installment")
  ) {
    return "AUTOMATION_ASSET_TYPE_MISMATCH";
  }
  if (
    (automation.recurringContributionAmount === 0) !==
    (automation.recurringContributionDay === 0)
  ) {
    return "INVALID_AUTOMATION_PLAN";
  }
  const hasLoanConfiguration =
    automation.loanMonthlyPaymentAmount > 0 || automation.loanPaymentDay > 0;
  if (hasLoanConfiguration && asset.type !== "loan") {
    return "AUTOMATION_ASSET_TYPE_MISMATCH";
  }
  if (
    (automation.loanMonthlyPaymentAmount === 0) !==
    (automation.loanPaymentDay === 0)
  ) {
    return "INVALID_AUTOMATION_PLAN";
  }
  if (hasLoanConfiguration) {
    const method = normalizeLoanRepaymentMethod(automation.loanRepaymentMethod);
    if (
      method !== "equal-principal" &&
      method !== "equal-principal-and-interest"
    ) {
      return "UNSUPPORTED_LOAN_REPAYMENT_METHOD";
    }
  }
  return undefined;
}

function effectiveDate(month: string, day: number): string | undefined {
  const result = calculateEffectivePaymentDatePolicy(month, day);
  return result.kind === "success" ? result.effectiveDate : undefined;
}

function firstDueDateAfter(
  month: string,
  configuredDay: number,
  occurredAt: string,
): string | undefined {
  let candidateMonth: string | undefined = month;
  for (let attempt = 0; attempt < 2 && candidateMonth !== undefined; attempt += 1) {
    const candidate = effectiveDate(candidateMonth, configuredDay);
    if (candidate === undefined) return undefined;
    const candidateInstant = Date.parse(`${candidate}T00:00:00+09:00`);
    const changedAt = Date.parse(occurredAt);
    if (
      !Number.isFinite(changedAt) ||
      !Number.isFinite(candidateInstant) ||
      candidateInstant >= changedAt
    ) {
      return candidate;
    }
    candidateMonth = followingMonth(candidateMonth);
  }
  return undefined;
}

function syncAutomationPlan(input: {
  readonly asset: AssetAutomationSubject;
  readonly previous?: AssetAutomationPlan;
  readonly operation: AssetAutomationPlan["operation"];
  readonly occurredAt: string;
}): AssetAutomationPlan | undefined {
  const { asset, previous, operation, occurredAt } = input;
  const savings = operation === "savings-contribution";
  const amount = savings
    ? asset.automation.recurringContributionAmount
    : asset.automation.loanMonthlyPaymentAmount;
  const day = savings
    ? asset.automation.recurringContributionDay
    : asset.automation.loanPaymentDay;
  const applicableType = savings
    ? asset.type === "savings" && asset.subType === "installment"
    : asset.type === "loan" &&
      ["equal-principal", "equal-principal-and-interest"].includes(
        normalizeLoanRepaymentMethod(asset.automation.loanRepaymentMethod) ?? "",
      );
  const active = applicableType && amount > 0 && day > 0;
  if (!active) {
    if (previous === undefined) return undefined;
    if (previous.status === "suspended" || previous.status === "recovering-before-stop") {
      return previous;
    }
    const hasOverdue = Date.parse(`${previous.nextDueDate}T00:00:00+09:00`) < Date.parse(occurredAt);
    return {
      ...previous,
      status: hasOverdue ? "recovering-before-stop" : "suspended",
      stopEffectiveAt: occurredAt,
      statusAfterRecovery: "suspended",
      aggregateVersion: previous.aggregateVersion + 1,
      updatedAt: occurredAt,
    };
  }

  const activatedOn = previous?.firstActivatedOn ?? seoulDate(occurredAt);
  const firstMonth = previous === undefined
    ? firstMonthForInitialActivationPolicy({
        assetCreatedOn: seoulDate(asset.createdAt),
        firstActivatedOn: activatedOn,
        configuredDay: day,
      })
    : {
        kind: "success" as const,
        firstApplicableMonth: previous.firstApplicableMonth,
        activationMonthDisposition: previous.activationMonthDisposition,
      };
  if (firstMonth.kind !== "success") return undefined;
  const lastAppliedMonth = savings
    ? asset.automation.lastAutoContributionMonth
    : asset.automation.lastAutoRepaymentMonth;
  const nextMonth =
    lastAppliedMonth === ""
      ? firstMonth.firstApplicableMonth
      : followingMonth(lastAppliedMonth);
  if (nextMonth === undefined) return undefined;
  const repaymentMethod = savings
    ? undefined
    : normalizeLoanRepaymentMethod(asset.automation.loanRepaymentMethod);
  const configuration = {
    amountInWon: amount,
    configuredDay: day,
    ...(repaymentMethod === undefined ? {} : { repaymentMethod }),
    ...(savings ? {} : { annualInterestRate: asset.automation.loanInterestRate }),
  };
  const configurationChanged =
    previous === undefined ||
    previous.amountInWon !== amount ||
    previous.configuredDay !== day ||
    previous.repaymentMethod !== repaymentMethod ||
    previous.annualInterestRate !==
      (savings ? undefined : asset.automation.loanInterestRate);
  const previousDueIsOverdue =
    previous !== undefined &&
    (previous.status === "active" || previous.status === "recovering-before-stop" ||
      previous.status === "needs-attention") &&
    previous.nextDueDate <= seoulDate(occurredAt);
  const previousDueMonth = previous?.nextDueDate.slice(0, 7);
  const rescheduleFromMonth =
    previousDueMonth !== undefined && parseYearMonth(previousDueMonth) !== undefined
      ? previousDueMonth
      : nextMonth;
  const nextDueDate = previousDueIsOverdue
    ? previous.nextDueDate
    : configurationChanged && previous !== undefined
      ? firstDueDateAfter(rescheduleFromMonth, day, occurredAt)
      : effectiveDate(nextMonth, day);
  if (nextDueDate === undefined) return undefined;
  const checkpointChanged =
    previous?.lastAppliedMonth !==
      (lastAppliedMonth === "" ? undefined : lastAppliedMonth) ||
    previous?.nextDueDate !== nextDueDate;
  if (
    previous !== undefined &&
    previous.status === "active" &&
    !configurationChanged &&
    !checkpointChanged
  ) {
    return previous;
  }
  const planId = `${asset.assetId}_${operation}`;
  return {
    planId,
    householdId: asset.householdId,
    assetId: asset.assetId,
    operation,
    kind: savings ? "savings-deposit" : "loan-repayment",
    status: "active",
    ...configuration,
    firstActivatedOn: activatedOn,
    activationMonthDisposition: firstMonth.activationMonthDisposition,
    firstApplicableMonth: firstMonth.firstApplicableMonth,
    nextDueDate,
    ...(lastAppliedMonth === "" ? {} : { lastAppliedMonth }),
    currentRevision:
      previous === undefined
        ? 1
        : previous.currentRevision + (configurationChanged ? 1 : 0),
    aggregateVersion: (previous?.aggregateVersion ?? 0) + 1,
    createdAt: previous?.createdAt ?? occurredAt,
    updatedAt: occurredAt,
  };
}

export function synchronizeAssetAutomationPlans(
  plans: readonly AssetAutomationPlan[],
  asset: AssetAutomationSubject,
  occurredAt: string,
): readonly AssetAutomationPlan[] {
  const operations: readonly AssetAutomationPlan["operation"][] = [
    "savings-contribution",
    "loan-repayment",
  ];
  const byOperation = new Map(
    plans
      .filter((plan) => plan.assetId === asset.assetId)
      .map((plan) => [plan.operation, plan]),
  );
  const replacements = operations.flatMap((operation) => {
    const plan = syncAutomationPlan({
      asset,
      previous: byOperation.get(operation),
      operation,
      occurredAt,
    });
    return plan === undefined ? [] : [plan];
  });
  return [
    ...plans.filter((plan) => plan.assetId !== asset.assetId),
    ...replacements,
  ];
}

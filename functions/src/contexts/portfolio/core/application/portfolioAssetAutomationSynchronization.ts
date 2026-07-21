import { createAssetAutomationDatePolicy } from "../../automation/public";
import { normalizeLoanRepaymentMethod } from "../domain/policies/legacyAssetNormalization";
import type {
  PortfolioRuntimeAsset,
  PortfolioRuntimeAutomationPlan,
  PortfolioRuntimeState,
} from "./ports/out/portfolioRuntimeStorePort";
import {
  optionalFiniteNonNegative,
  optionalNonNegativeWon,
  optionalText,
  type ParseResult,
} from "./portfolioRuntimeSupport";

const automationDates = createAssetAutomationDatePolicy();

function parseYearMonth(value: string): { year: number; month: number } | undefined {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/u.exec(value);
  if (match === null) return undefined;
  return { year: Number(match[1]), month: Number(match[2]) };
}

function nextYearMonth(value: string): string | undefined {
  const parsed = parseYearMonth(value);
  if (parsed === undefined) return undefined;
  return parsed.month === 12
    ? `${String(parsed.year + 1).padStart(4, "0")}-01`
    : `${String(parsed.year).padStart(4, "0")}-${String(parsed.month + 1).padStart(2, "0")}`;
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

export function parseAutomationFields(
  raw: Record<string, unknown>,
  base?: PortfolioRuntimeAsset["automation"],
): ParseResult<PortfolioRuntimeAsset["automation"]> {
  const defaults: PortfolioRuntimeAsset["automation"] =
    base ?? {
      recurringContributionAmount: 0,
      recurringContributionDay: 0,
      lastAutoContributionMonth: "",
      loanInterestRate: 0,
      loanRepaymentMethod: "",
      loanMonthlyPaymentAmount: 0,
      loanPaymentDay: 0,
      lastAutoRepaymentMonth: "",
    };
  const recurringAmount = optionalNonNegativeWon(
    raw.recurringContributionAmount,
    defaults.recurringContributionAmount,
    "INVALID_AUTOMATION_AMOUNT",
  );
  const loanAmount = optionalNonNegativeWon(
    raw.loanMonthlyPaymentAmount,
    defaults.loanMonthlyPaymentAmount,
    "INVALID_AUTOMATION_AMOUNT",
  );
  const interest = optionalFiniteNonNegative(
    raw.loanInterestRate,
    defaults.loanInterestRate,
    "INVALID_LOAN_INTEREST_RATE",
  );
  if (
    recurringAmount.kind === "error" ||
    loanAmount.kind === "error" ||
    interest.kind === "error"
  ) {
    return {
      kind: "error",
      code:
        recurringAmount.kind === "error"
          ? recurringAmount.code
          : loanAmount.kind === "error"
            ? loanAmount.code
            : interest.kind === "error"
              ? interest.code
              : "INVALID_AUTOMATION_PLAN",
    };
  }
  const parseDay = (value: unknown, fallback: number): number | undefined => {
    const resolved = value === undefined ? fallback : value;
    return Number.isInteger(resolved) &&
      (resolved as number) >= 0 &&
      (resolved as number) <= 31
      ? (resolved as number)
      : undefined;
  };
  const recurringDay = parseDay(
    raw.recurringContributionDay,
    defaults.recurringContributionDay,
  );
  const loanDay = parseDay(raw.loanPaymentDay, defaults.loanPaymentDay);
  if (recurringDay === undefined || loanDay === undefined) {
    return { kind: "error", code: "INVALID_AUTOMATION_DAY" };
  }
  const contributionMonth = optionalText(
    raw.lastAutoContributionMonth,
    defaults.lastAutoContributionMonth,
    "INVALID_AUTOMATION_CHECKPOINT",
  );
  const repaymentMonth = optionalText(
    raw.lastAutoRepaymentMonth,
    defaults.lastAutoRepaymentMonth,
    "INVALID_AUTOMATION_CHECKPOINT",
  );
  const repaymentMethod = optionalText(
    raw.loanRepaymentMethod,
    defaults.loanRepaymentMethod,
    "INVALID_LOAN_REPAYMENT_METHOD",
  );
  if (
    contributionMonth.kind === "error" ||
    repaymentMonth.kind === "error" ||
    repaymentMethod.kind === "error"
  ) {
    return {
      kind: "error",
      code:
        contributionMonth.kind === "error"
          ? contributionMonth.code
          : repaymentMonth.kind === "error"
            ? repaymentMonth.code
            : repaymentMethod.kind === "error"
              ? repaymentMethod.code
              : "INVALID_AUTOMATION_PLAN",
    };
  }
  if (
    (contributionMonth.value !== "" &&
      parseYearMonth(contributionMonth.value) === undefined) ||
    (repaymentMonth.value !== "" &&
      parseYearMonth(repaymentMonth.value) === undefined)
  ) {
    return { kind: "error", code: "INVALID_AUTOMATION_CHECKPOINT" };
  }
  return {
    kind: "success",
    value: {
      recurringContributionAmount: recurringAmount.value ?? 0,
      recurringContributionDay: recurringDay,
      lastAutoContributionMonth: contributionMonth.value,
      loanInterestRate: interest.value ?? 0,
      loanRepaymentMethod: repaymentMethod.value,
      loanMonthlyPaymentAmount: loanAmount.value ?? 0,
      loanPaymentDay: loanDay,
      lastAutoRepaymentMonth: repaymentMonth.value,
    },
  };
}

function normalizedRepaymentMethod(value: string): string | undefined {
  return normalizeLoanRepaymentMethod(value);
}

export function validateAutomationForAsset(
  asset: PortfolioRuntimeAsset,
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
    const method = normalizedRepaymentMethod(automation.loanRepaymentMethod);
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
  const result = automationDates.calculateEffectivePaymentDate(month, day);
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
    candidateMonth = nextYearMonth(candidateMonth);
  }
  return undefined;
}

function syncAutomationPlan(input: {
  readonly asset: PortfolioRuntimeAsset;
  readonly previous?: PortfolioRuntimeAutomationPlan;
  readonly operation: PortfolioRuntimeAutomationPlan["operation"];
  readonly occurredAt: string;
}): PortfolioRuntimeAutomationPlan | undefined {
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
        normalizedRepaymentMethod(asset.automation.loanRepaymentMethod) ?? "",
      );
  const active = applicableType && amount > 0 && day > 0;
  if (!active) {
    if (previous === undefined) return undefined;
    if (previous.status === "suspended") return previous;
    return {
      ...previous,
      status: "suspended",
      aggregateVersion: previous.aggregateVersion + 1,
      updatedAt: occurredAt,
    };
  }

  const activatedOn = previous?.firstActivatedOn ?? seoulDate(occurredAt);
  const firstMonth = automationDates.firstMonthForInitialActivation({
    assetCreatedOn: seoulDate(asset.createdAt),
    firstActivatedOn: activatedOn,
    configuredDay: day,
  });
  if (firstMonth.kind !== "success") return undefined;
  const lastAppliedMonth = savings
    ? asset.automation.lastAutoContributionMonth
    : asset.automation.lastAutoRepaymentMonth;
  const nextMonth =
    lastAppliedMonth === ""
      ? firstMonth.firstApplicableMonth
      : nextYearMonth(lastAppliedMonth);
  if (nextMonth === undefined) return undefined;
  const repaymentMethod = savings
    ? undefined
    : normalizedRepaymentMethod(asset.automation.loanRepaymentMethod);
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
    previous.status === "active" &&
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

export function plansAfterAssetChange(
  state: PortfolioRuntimeState,
  asset: PortfolioRuntimeAsset,
  occurredAt: string,
): readonly PortfolioRuntimeAutomationPlan[] {
  const operations: readonly PortfolioRuntimeAutomationPlan["operation"][] = [
    "savings-contribution",
    "loan-repayment",
  ];
  const byOperation = new Map(
    state.automationPlans
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
    ...state.automationPlans.filter((plan) => plan.assetId !== asset.assetId),
    ...replacements,
  ];
}

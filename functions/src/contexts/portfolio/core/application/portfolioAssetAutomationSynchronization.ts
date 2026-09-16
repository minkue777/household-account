import { ASSET_AUTOMATION_FIELDS, parseYearMonth } from "../../automation/public";
import type { PortfolioRuntimeAsset } from "./ports/out/portfolioRuntimeStorePort";
import {
  optionalFiniteNonNegative,
  optionalNonNegativeWon,
  optionalText,
  type ParseResult,
} from "./portfolioRuntimeSupport";

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
/** Reading a plan is necessary only when a command can change its configuration. */
export function changesAssetAutomation(raw: Readonly<Record<string, unknown>>): boolean {
  return ["type", "subType", ...ASSET_AUTOMATION_FIELDS]
    .some(field => raw[field] !== undefined);
}

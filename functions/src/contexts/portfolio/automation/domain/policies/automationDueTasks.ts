import type {
  AutomatedAssetView,
  AutomationPlanView,
  AutomationRevisionView,
} from "../model/assetAutomationExecution";
import { evaluateSavingsContributionPolicy } from "./savingsContribution";
import { calculateLoanPrincipalPaymentPolicy } from "./loanPrincipalPayment";
import { nextYearMonth, parseYearMonth } from "../value-objects/yearMonth";

export interface AutomationDueTask {
  plan: AutomationPlanView;
  asset: AutomatedAssetView;
  targetMonth: string;
  effectiveDate: string;
  revision: AutomationRevisionView;
  balanceDeltaInWon: number;
  executionKey: string;
}

export type AutomationDuePlanResult =
  | { kind: "ready"; tasks: readonly AutomationDueTask[] }
  | { kind: "invalid"; code: string };

function effectiveRevision(
  plan: AutomationPlanView,
  targetMonth: string,
): AutomationRevisionView | undefined {
  return [...plan.revisions]
    .filter(({ effectiveFromMonth }) => effectiveFromMonth <= targetMonth)
    .sort(
      (left, right) =>
        right.effectiveFromMonth.localeCompare(left.effectiveFromMonth) ||
        right.revision - left.revision,
    )[0];
}

export function buildAutomationDueTasks(input: {
  plan: AutomationPlanView;
  asset: AutomatedAssetView;
  asOfDate: string;
}): AutomationDuePlanResult {
  const firstMonth = input.plan.nextDueDate.slice(0, 7);
  if (parseYearMonth(firstMonth) === undefined) {
    return { kind: "invalid", code: "INVALID_TARGET_MONTH" };
  }
  const tasks: AutomationDueTask[] = [];
  let evaluatedBalance = input.asset.currentBalanceInWon;
  let targetMonth = firstMonth;
  while (targetMonth <= input.asOfDate.slice(0, 7)) {
    const revision = effectiveRevision(input.plan, targetMonth);
    if (revision === undefined) {
      return { kind: "invalid", code: "AUTOMATION_REVISION_NOT_FOUND" };
    }
    const evaluated = evaluateSavingsContributionPolicy({
      targetMonth,
      configuredDay: revision.configuredDay,
      amount: revision.amountInWon,
      asOfDate: input.asOfDate,
    });
    if (evaluated.kind === "validation-error") {
      return { kind: "invalid", code: evaluated.code };
    }
    if (evaluated.kind === "not-due") break;
    let balanceDeltaInWon = evaluated.balanceDelta;
    if (input.plan.kind === "loan-repayment") {
      const repayment = calculateLoanPrincipalPaymentPolicy({
        balance: evaluatedBalance,
        annualInterestRate: revision.annualInterestRate ?? Number.NaN,
        monthlyPayment: revision.amountInWon,
        method: revision.repaymentMethod ?? "bullet",
      });
      if (repayment.kind === "validation-error") {
        return { kind: "invalid", code: repayment.code };
      }
      if (repayment.kind === "unsupported-method") {
        return { kind: "ready", tasks };
      }
      balanceDeltaInWon = -repayment.principal;
      evaluatedBalance = repayment.resultingBalance;
    } else {
      evaluatedBalance += balanceDeltaInWon;
    }
    tasks.push({
      plan: input.plan,
      asset: input.asset,
      targetMonth,
      effectiveDate: evaluated.effectiveDate,
      revision,
      balanceDeltaInWon,
      executionKey: `${input.plan.planId}:${targetMonth}`,
    });
    const parsed = parseYearMonth(targetMonth);
    if (parsed === undefined) {
      return { kind: "invalid", code: "INVALID_TARGET_MONTH" };
    }
    targetMonth = nextYearMonth(parsed);
  }
  return { kind: "ready", tasks };
}

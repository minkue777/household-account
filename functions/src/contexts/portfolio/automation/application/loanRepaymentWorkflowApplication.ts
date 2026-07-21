import type {
  LoanEvaluation,
  LoanPlan,
  RunRepaymentResult,
} from "../domain/model/loanRepaymentWorkflow";
import { calculateEffectivePaymentDatePolicy } from "../domain/policies/effectivePaymentDate";
import { calculateLoanPrincipalPaymentPolicy } from "../domain/policies/loanPrincipalPayment";
import type { LoanRepaymentWorkflow } from "./ports/in/loanRepaymentWorkflow";
import type { LoanRepaymentStore } from "./ports/out/loanRepaymentStore";

function evaluatePlan(
  plan: LoanPlan,
  targetMonth: string,
  _asOfDate: string,
): Exclude<LoanEvaluation, { kind: "already-processed" }> {
  const date = calculateEffectivePaymentDatePolicy(
    targetMonth,
    plan.configuredDay,
  );
  if (date.kind === "validation-error") {
    return { kind: "validation-error", code: "INVALID_PAYMENT_DAY" };
  }
  const principal = calculateLoanPrincipalPaymentPolicy({
    balance: plan.balance,
    annualInterestRate: plan.annualInterestRate,
    monthlyPayment: plan.monthlyPayment,
    method: plan.repaymentMethod,
  });
  if (principal.kind !== "success") return principal;
  return {
    kind: "due",
    principal: principal.principal,
    resultingBalance: principal.resultingBalance,
  };
}

export function createLoanRepaymentWorkflowApplication(
  store: LoanRepaymentStore,
): LoanRepaymentWorkflow {
  return {
    evaluate(targetMonth, asOfDate) {
      const state = store.state();
      const executionId = state.executionsByMonth[targetMonth];
      return executionId === undefined
        ? evaluatePlan(state.plan, targetMonth, asOfDate)
        : { kind: "already-processed", executionId };
    },
    run: (input) =>
      store.transact((state) => {
        const replay = state.receipts[input.idempotencyKey];
        if (replay !== undefined) return { kind: "return", result: replay };
        const claimedExecution = state.executionsByMonth[input.targetMonth];
        if (claimedExecution !== undefined) {
          return {
            kind: "return",
            result: {
              kind: "already-processed",
              executionId: claimedExecution,
            },
          };
        }
        const evaluated = evaluatePlan(
          state.plan,
          input.targetMonth,
          input.asOfDate,
        );
        if (evaluated.kind !== "due") {
          return { kind: "return", result: evaluated };
        }
        const executionId = `loan-execution:${state.plan.assetId}:${input.targetMonth}`;
        const result: RunRepaymentResult = {
          kind: "success",
          executionId,
          principal: evaluated.principal,
          resultingBalance: evaluated.resultingBalance,
        };
        return {
          kind: "commit",
          state: {
            plan: { ...state.plan, balance: evaluated.resultingBalance },
            executionsByMonth: {
              ...state.executionsByMonth,
              [input.targetMonth]: executionId,
            },
            receipts: {
              ...state.receipts,
              [input.idempotencyKey]: result,
            },
          },
          event: {
            eventType: "AssetAutomationApplied.v1",
            assetId: state.plan.assetId,
            targetMonth: input.targetMonth,
            appliedAmount: evaluated.principal,
            executionId,
          },
          result,
        };
      }),
    currentBalance: () => store.state().plan.balance,
    executionIds: () => store.executionIds(),
    recordedEvents: () => store.events(),
  };
}

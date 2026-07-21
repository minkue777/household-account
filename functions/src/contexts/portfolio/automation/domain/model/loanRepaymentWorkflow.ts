import type { LoanRepaymentMethod } from "../policies/loanPrincipalPayment";

export interface LoanPlan {
  assetId: string;
  balance: number;
  annualInterestRate: number;
  monthlyPayment: number;
  configuredDay: number;
  repaymentMethod: LoanRepaymentMethod;
}

export type LoanEvaluation =
  | { kind: "due"; principal: number; resultingBalance: number }
  | { kind: "unsupported-method"; method: "bullet" }
  | {
      kind: "validation-error";
      code:
        | "INVALID_INTEREST_RATE"
        | "INVALID_AUTOMATION_AMOUNT"
        | "INVALID_PAYMENT_DAY";
    }
  | { kind: "already-processed"; executionId: string };

export type RunRepaymentResult =
  | {
      kind: "success";
      executionId: string;
      principal: number;
      resultingBalance: number;
    }
  | { kind: "unsupported-method"; method: "bullet" }
  | { kind: "validation-error"; code: string }
  | { kind: "already-processed"; executionId: string };

export interface AutomationAppliedEvent {
  eventType: "AssetAutomationApplied.v1";
  assetId: string;
  targetMonth: string;
  appliedAmount: number;
  executionId: string;
}

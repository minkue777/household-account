import type {
  AutomationAppliedEvent,
  LoanPlan,
  RunRepaymentResult,
} from "../../../domain/model/loanRepaymentWorkflow";

export interface LoanRepaymentState {
  plan: LoanPlan;
  executionsByMonth: Readonly<Record<string, string>>;
  receipts: Readonly<Record<string, RunRepaymentResult>>;
}

export type LoanRepaymentDecision =
  | { kind: "return"; result: RunRepaymentResult }
  | {
      kind: "commit";
      state: LoanRepaymentState;
      event: AutomationAppliedEvent;
      result: RunRepaymentResult;
    };

export interface LoanRepaymentStore {
  state(): LoanRepaymentState;
  transact(
    decide: (state: LoanRepaymentState) => LoanRepaymentDecision,
  ): Promise<RunRepaymentResult>;
  executionIds(): readonly string[];
  events(): readonly AutomationAppliedEvent[];
}

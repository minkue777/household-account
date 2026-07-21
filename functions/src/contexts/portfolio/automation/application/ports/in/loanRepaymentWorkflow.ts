import type {
  AutomationAppliedEvent,
  LoanEvaluation,
  RunRepaymentResult,
} from "../../../domain/model/loanRepaymentWorkflow";

export interface LoanRepaymentWorkflow {
  evaluate(targetMonth: string, asOfDate: string): LoanEvaluation;
  run(input: {
    targetMonth: string;
    asOfDate: string;
    idempotencyKey: string;
  }): Promise<RunRepaymentResult>;
  currentBalance(): number;
  executionIds(): readonly string[];
  recordedEvents(): readonly AutomationAppliedEvent[];
}

import type {
  AssetAutomationAppliedEvent,
  AutomationExecutionState,
  AutomationExecutionView,
  AutomationReceipt,
  AutomationRunResult,
} from "../../../domain/model/assetAutomationExecution";

export type AutomationApplyDecision =
  | { kind: "already-processed" }
  | {
      kind: "commit";
      state: AutomationExecutionState;
      execution: AutomationExecutionView;
      receipt: AutomationReceipt;
      event: AssetAutomationAppliedEvent;
    };

export interface AssetAutomationExecutionStore {
  state(): AutomationExecutionState;
  apply(
    decide: (state: AutomationExecutionState) => AutomationApplyDecision,
  ): Promise<"applied" | "already-processed">;
  markPlanNeedsAttention(planId: string, code: string): void;
  occurrenceReceipt(occurrenceId: string): AutomationRunResult | undefined;
  saveOccurrenceReceipt(
    occurrenceId: string,
    result: AutomationRunResult,
  ): void;
  events(): readonly AssetAutomationAppliedEvent[];
}

export interface AutomationExecutionOutcomeSource {
  outcome(input: {
    occurrenceId: string;
    executionKey: string;
  }): "success" | "retryable-failure";
}

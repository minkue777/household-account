import type {
  AutomatedAssetView,
  AssetAutomationAppliedEvent,
  AutomationExecutionView,
  AutomationPlanView,
  AutomationReceipt,
  AutomationRunResult,
} from "../../../domain/model/assetAutomationExecution";

export interface AssetAutomationExecution {
  runOccurrence(input: {
    occurrenceId: string;
    scheduledFor: string;
    asOfDate: string;
    resumeFromCheckpoint?: string;
  }): Promise<AutomationRunResult>;
  inspectAsset(assetId: string): Promise<AutomatedAssetView>;
  inspectPlan(planId: string): Promise<AutomationPlanView>;
  listExecutions(planId: string): Promise<readonly AutomationExecutionView[]>;
  receipts(): readonly AutomationReceipt[];
  recordedEvents(): readonly AssetAutomationAppliedEvent[];
}

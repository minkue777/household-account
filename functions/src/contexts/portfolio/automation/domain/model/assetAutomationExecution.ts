export type AutomationKind = "savings-deposit" | "loan-repayment";

export interface AutomationRevisionView {
  revision: number;
  effectiveFromMonth: string;
  amountInWon: number;
  configuredDay: number;
  annualInterestRate?: number;
  repaymentMethod?:
    | "equal-principal"
    | "equal-principal-and-interest"
    | "bullet";
}

export interface AutomationPlanView {
  planId: string;
  householdId: string;
  assetId: string;
  kind: AutomationKind;
  status: "active" | "needs-attention" | "suspended";
  nextDueDate: string;
  currentRevision: number;
  revisions: readonly AutomationRevisionView[];
  attentionCode?: string;
}

export interface AutomatedAssetView {
  assetId: string;
  lifecycle: "active" | "deleted" | "purging";
  currentBalanceInWon: number;
  aggregateVersion: number;
}

export interface AutomationExecutionView {
  executionId: string;
  executionKey: string;
  occurrenceId: string;
  planId: string;
  assetId: string;
  targetMonth: string;
  effectiveDate: string;
  appliedRevision: number;
  balanceDeltaInWon: number;
  resultingBalanceInWon: number;
  status: "applied";
}

export interface AutomationReceipt {
  receiptId: string;
  occurrenceId: string;
  executionKey: string;
  resultingAssetVersion: number;
}

export interface AssetAutomationAppliedEvent {
  eventType: "AssetAutomationApplied.v1";
  executionId: string;
  executionKey: string;
  assetId: string;
  targetMonth: string;
  balanceDeltaInWon: number;
  aggregateVersion: number;
}

export interface AutomationRunResult {
  kind: "complete" | "partial-failure";
  occurrenceId: string;
  pageResults: readonly {
    pageNumber: number;
    planIds: readonly string[];
    checkpointAfter?: string;
    terminal: true;
  }[];
  appliedExecutionKeys: readonly string[];
  retryableFailures: readonly { executionKey: string; code: string }[];
  invalidPlanIds: readonly string[];
  checkpoint?: string;
}

export interface AutomationExecutionState {
  assets: readonly AutomatedAssetView[];
  plans: readonly AutomationPlanView[];
  executions: readonly AutomationExecutionView[];
  receipts: readonly AutomationReceipt[];
}

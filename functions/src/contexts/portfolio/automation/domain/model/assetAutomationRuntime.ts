export type AssetAutomationOperation =
  | "savings-contribution"
  | "loan-repayment";

export interface DueAssetAutomationPlan {
  readonly householdId: string;
  readonly planId: string;
  readonly assetId?: string;
  readonly operation?: AssetAutomationOperation;
  /** The value observed by the ordered due-plan query. */
  readonly nextDueDate: string;
  /** Stable canonical Firestore document path, never a display name. */
  readonly documentPath: string;
}

export type AssetAutomationTargetResult =
  | {
      readonly kind: "applied";
      readonly executionKey: string;
      readonly executionId: string;
      readonly assetId: string;
      readonly operation: AssetAutomationOperation;
      readonly targetMonth: string;
      readonly nextDueDate: string;
    }
  | {
      readonly kind: "already-processed";
      readonly executionKey: string;
      readonly executionId: string;
      readonly assetId: string;
      readonly operation: AssetAutomationOperation;
      readonly targetMonth: string;
      readonly nextDueDate: string;
    }
  | {
      readonly kind: "skipped";
      readonly targetId: string;
      readonly code:
        | "ASSET_NOT_ACTIVE"
        | "PLAN_NOT_DUE"
        | "PLAN_NOT_RUNNABLE"
        | "UNSUPPORTED_LOAN_REPAYMENT_METHOD";
    }
  | {
      readonly kind: "needs-attention";
      readonly targetId: string;
      readonly code: string;
    }
  | {
      readonly kind: "retryable-failure";
      readonly targetId: string;
      readonly code: string;
    };

export interface AssetAutomationPageResult {
  readonly completed: boolean;
  readonly nextCursor?: string;
  readonly results: readonly AssetAutomationTargetResult[];
}

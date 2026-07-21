import type {
  AssetAutomationTargetResult,
  DueAssetAutomationPlan,
} from "../../../domain/model/assetAutomationRuntime";

export interface DueAssetAutomationPlanPage {
  readonly plans: readonly DueAssetAutomationPlan[];
  /** Opaque adapter cursor ordered by nextDueDate and canonical document path. */
  readonly nextCursor?: string;
}

export interface AssetAutomationRuntimeStorePort {
  listDuePlans(input: {
    readonly asOfDate: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<DueAssetAutomationPlanPage>;

  /**
   * Re-reads Plan, effective Revision, Asset and execution claim in one UoW.
   * A successful result advances exactly the month observed in `plan`.
   */
  applyNextDue(input: {
    readonly plan: DueAssetAutomationPlan;
    readonly asOfDate: string;
    readonly occurrenceId: string;
    readonly processedAt: string;
  }): Promise<AssetAutomationTargetResult>;
}

import type { ScopedValuationRunResult } from "../../../domain/model/assetValuationTriggerScope";
import type { ValuationChildReceipt } from "../../../domain/model/assetValuationTriggerScope";

export interface AssetValuationTriggerScope {
  refreshSingleAsset(input: {
    actorHouseholdId: string;
    assetId: string;
    requestedAt: string;
    idempotencyKey: string;
  }): Promise<ScopedValuationRunResult>;
  refreshHouseholdOnPageEntry(input: {
    actorHouseholdId: string;
    requestedAt: string;
  }): Promise<ScopedValuationRunResult>;
  runDailyValuation(input: {
    occurrenceId: string;
    scheduledFor: string;
    asOfDate: string;
    resumeFromCheckpoint?: string;
  }): Promise<ScopedValuationRunResult>;
  currentAssetValues(): Readonly<Record<string, number>>;
  childReceipts(): readonly ValuationChildReceipt[];
  listRuns(): readonly ScopedValuationRunResult[];
}

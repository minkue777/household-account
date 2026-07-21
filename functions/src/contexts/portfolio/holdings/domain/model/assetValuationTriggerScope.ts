import type { ValuationMarket } from "./dailyAssetValuation";

export interface ValuationHousehold {
  householdId: string;
  lifecycle: "active" | "deleted";
}

export interface ScopedValuationTarget {
  targetId: string;
  householdId: string;
  assetId: string;
  assetLifecycle: "active" | "deleted" | "purging";
  market: ValuationMarket;
  previousValueInWon: number;
}

export type ScopedProviderResult =
  | { kind: "success"; valueInWon: number }
  | { kind: "retryable-failure"; code: string };

export interface ValuationChildReceipt {
  childKey: string;
  runId: string;
  householdId: string;
  assetId: string;
  outcome: "succeeded" | "retained-last-success";
  resultingValueInWon: number;
}

export interface ScopedValuationRunResult {
  kind: "complete" | "partial-failure" | "interrupted";
  runId: string;
  trigger: "manual-asset" | "asset-page-entry" | "daily-23:55";
  householdIds: readonly string[];
  processedTargetIds: readonly string[];
  pageReceipts: readonly {
    pageNumber: number;
    targetIds: readonly string[];
    terminal: true;
    checkpointAfter?: string;
  }[];
  retryableFailures: readonly { targetId: string; code: string }[];
  snapshotRequestedForHouseholdIds: readonly string[];
  checkpoint?: string;
}

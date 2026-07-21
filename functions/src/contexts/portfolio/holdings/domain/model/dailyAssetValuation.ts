export type ValuationMarket =
  | "KRX"
  | "US"
  | "KOFIA_FUND"
  | "UPBIT_KRW"
  | "PHYSICAL_GOLD";

export interface DailyValuationTarget {
  targetId: string;
  assetId: string;
  market: ValuationMarket;
  assetType: string;
  ownerRefKey: string;
  previousSuccessfulValue: number;
}

export type DailyTargetValuationResult =
  | { kind: "success"; valueInWon: number }
  | { kind: "retryable-failure"; code: string };

export interface DailyValuationRunView {
  kind: "complete" | "partial-failure";
  runId: string;
  createdAt: string;
  completed: true;
  pageReceipts: readonly {
    pageNumber: number;
    targetIds: readonly string[];
    terminal: true;
  }[];
  succeeded: readonly string[];
  retryableFailed: readonly {
    targetId: string;
    code: string;
    retainedValueInWon: number;
  }[];
  maxObservedProviderConcurrency: number;
  snapshotProjectionStatus: "queued" | "up-to-date";
}

export interface AssetSnapshotIntentView {
  localDate: string;
  total: number;
  financial: number;
  byType: Readonly<Record<string, number>>;
  byOwnerRefKey: Readonly<Record<string, number>>;
  createdAt: string;
}

export interface DailyAssetValuationChangedEvent {
  eventType: "AssetValuationChanged.v1";
  assetId: string;
  currentSignedBalance: number;
}

export interface RunDailyAssetValuationCommand {
  trigger: "asset-page-entry" | "daily-23:55";
  householdId?: string;
  requestedAt: string;
  asOfDate: string;
  idempotencyKey?: string;
}

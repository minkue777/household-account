export interface LegacyValuationAsset {
  assetId: string;
  legacyIsActive?: boolean;
  lifecycleState?: "active" | "deleted";
  currentBalance: number;
  aggregateVersion: number;
}

export interface NormalizedValuationAsset extends LegacyValuationAsset {
  normalizedLifecycle: "active" | "deleted";
}

export type RecoveryProviderOutcome =
  | { kind: "success"; valueInWon: number }
  | { kind: "retryable-failure"; code: string };

export interface DailyValuationRecoveryRunView {
  kind: "complete" | "partial-failure";
  succeeded: readonly string[];
  retryableFailed: readonly { assetId: string; code: string }[];
  excludedDeleted: readonly string[];
}

export interface DailyValuationRecoveryEvent {
  eventType: "AssetValuationChanged.v1";
  assetId: string;
  currentSignedBalance: number;
}

export interface RunDailyValuationRecoveryCommand {
  runId: string;
  outcomes: Readonly<Record<string, RecoveryProviderOutcome>>;
  expectedVersions: Readonly<Record<string, number>>;
}

export interface AssetSnapshotFact {
  snapshotId: string;
  snapshotDate: string;
  amountInWon: number;
  aggregateVersion: number;
}

export interface AssetSnapshotSourcePage {
  cursor?: string;
  nextCursor?: string;
  sourceCheckpoint: string;
  items: readonly AssetSnapshotFact[];
}

export type AssetSnapshotSourceResult =
  | { kind: "ready"; pages: readonly AssetSnapshotSourcePage[] }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string }
  | { kind: "contract-failure"; code: string };

export interface AssetStatisticsSourceRequest {
  householdId: string;
  memberId: string;
  baselineAtOrBefore: string;
  windowStartDate: string;
  windowEndDate: string;
  pageLimit: number;
}

export interface AssetStatisticsResultView {
  period: { startDate: string; endDate: string };
  selectedBaseline?: AssetSnapshotFact;
  points: readonly { date: string; amountInWon: number }[];
  sourceCheckpoint: string;
  sourceRowCount: number;
}

export type BoundedAssetStatisticsResult =
  | { kind: "success"; value: AssetStatisticsResultView }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string }
  | { kind: "contract-failure"; code: string };

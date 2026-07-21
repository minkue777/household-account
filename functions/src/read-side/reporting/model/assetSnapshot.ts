export interface AssetSnapshotFact {
  snapshotDate: string;
  amountInWon: number;
  aggregateVersion: number;
}

export type AssetSnapshotSourceResult =
  | {
      kind: "ready";
      baseline?: AssetSnapshotFact;
      window: readonly AssetSnapshotFact[];
      sourceCheckpoint: string;
    }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string };

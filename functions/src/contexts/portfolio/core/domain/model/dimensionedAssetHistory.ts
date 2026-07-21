export type AssetOwnerRefKey = "household" | `profile:${string}`;

export interface AssetHistoryPointV1 {
  localDate: string;
  total: number;
  financial: number;
  byType: Readonly<Record<string, number>>;
  byOwnerRefKey: Readonly<Partial<Record<AssetOwnerRefKey, number>>>;
  source: "stored-snapshot" | "live-today";
}

export interface AssetHistoryViewV1 {
  schemaVersion: 1;
  points: readonly AssetHistoryPointV1[];
  dimensions: {
    typeKeys: readonly string[];
    ownerRefKeys: readonly AssetOwnerRefKey[];
  };
  sourceCheckpoint: string;
  updatedAt: string;
  freshness: "fresh" | "stale" | "rebuilding";
}

export type AssetHistoryProjectionSource =
  | {
      kind: "ready";
      baseline?: AssetHistoryPointV1;
      window: readonly AssetHistoryPointV1[];
      sourceCheckpoint: string;
      updatedAt: string;
      freshness: "fresh" | "stale" | "rebuilding";
    }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string };

export type QueryDimensionedAssetHistoryResult =
  | { kind: "success"; value: AssetHistoryViewV1 }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string };

import type {
  PortfolioAssetFact,
  PortfolioTotals,
} from "../policies/portfolioTotals";

export interface AssetSnapshotSourceView {
  readonly assets: readonly PortfolioAssetFact[];
  readonly ownerDisplayNames: Readonly<Record<string, string>>;
}

export interface PreviousAssetSnapshotView {
  readonly localDate: string;
  readonly total: number;
  readonly financial: number;
  readonly byType: Readonly<Record<string, number>>;
  readonly byOwnerRefKey: Readonly<Record<string, number>>;
  readonly ownerDisplayNames: Readonly<Record<string, string>>;
}

export interface AssetSnapshotProjectionView extends PortfolioTotals {
  readonly schemaVersion: 1;
  readonly householdId: string;
  readonly localDate: string;
  readonly ownerDisplayNames: Readonly<Record<string, string>>;
  readonly sourceCheckpoint: string;
}

export type AssetSnapshotProjectionResult =
  | {
      readonly kind: "projected";
      readonly snapshot: AssetSnapshotProjectionView;
    }
  | {
      readonly kind: "replayed";
      readonly snapshot: AssetSnapshotProjectionView;
    }
  | {
      readonly kind: "validation-error";
      readonly code: "INVALID_MONEY";
      readonly assetId: string;
    }
  | {
      readonly kind: "retryable-failure";
      readonly code: "SNAPSHOT_REBUILD_RETRYABLE";
    };

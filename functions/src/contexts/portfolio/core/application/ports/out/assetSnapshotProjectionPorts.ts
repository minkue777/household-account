import type {
  AssetSnapshotProjectionView,
  AssetSnapshotSourceView,
  PreviousAssetSnapshotView,
} from "../../../domain/model/assetSnapshotProjection";

export interface AssetSnapshotProjectionSourcePort {
  readCurrent(householdId: string): Promise<AssetSnapshotSourceView>;
}

export interface AssetSnapshotProjectionStorePort {
  latestBefore(input: {
    householdId: string;
    localDate: string;
  }): Promise<PreviousAssetSnapshotView | undefined>;

  upsert(
    snapshot: AssetSnapshotProjectionView,
  ): Promise<"projected" | "replayed">;
}

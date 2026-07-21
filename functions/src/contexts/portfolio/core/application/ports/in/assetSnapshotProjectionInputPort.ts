import type { AssetSnapshotProjectionResult } from "../../../domain/model/assetSnapshotProjection";

export interface AssetSnapshotProjectionInputPort {
  project(input: {
    householdId: string;
    localDate: string;
    sourceCheckpoint: string;
    calculatedAt: string;
  }): Promise<AssetSnapshotProjectionResult>;
}

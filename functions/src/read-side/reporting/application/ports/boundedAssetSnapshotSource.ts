import type {
  AssetSnapshotSourceResult,
  AssetStatisticsSourceRequest,
} from "../../model/boundedAssetStatistics";

export interface BoundedAssetSnapshotSourcePort {
  load(
    request: AssetStatisticsSourceRequest,
  ): Promise<AssetSnapshotSourceResult>;
}

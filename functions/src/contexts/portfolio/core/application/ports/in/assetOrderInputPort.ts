import type {
  OrderedAssetView,
  ReorderAssetsResult,
} from "../../../domain/model/assetOrder";

export interface ReorderAssetsCommand {
  readonly orderedAssetIds: readonly string[];
  readonly expectedVersions: Readonly<Record<string, number>>;
}

export interface AssetOrderInputPort {
  reorder(command: ReorderAssetsCommand): Promise<ReorderAssetsResult>;
}

export type { OrderedAssetView, ReorderAssetsResult };

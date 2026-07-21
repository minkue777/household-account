import type {
  AssetOrderDecision,
  OrderedAssetView,
  ReorderAssetsResult,
} from "../../../domain/model/assetOrder";

export interface AssetOrderUnitOfWork {
  transact(
    decide: (current: readonly OrderedAssetView[]) => AssetOrderDecision,
  ): Promise<ReorderAssetsResult>;
}

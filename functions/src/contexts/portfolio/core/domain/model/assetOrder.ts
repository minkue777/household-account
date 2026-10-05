export interface OrderedAssetView {
  readonly assetId: string;
  readonly order: number;
  readonly aggregateVersion: number;
}

export type ReorderAssetsResult =
  | { readonly kind: "success"; readonly assets: readonly OrderedAssetView[] }
  | { readonly kind: "validation-error"; readonly code: "INVALID_ORDER_SET" }
  | {
      readonly kind: "conflict";
      readonly code: "ASSET_ORDER_VERSION_MISMATCH";
    };

export type AssetOrderDecision =
  | { readonly kind: "return"; readonly result: ReorderAssetsResult }
  | {
      readonly kind: "commit";
      readonly assets: readonly OrderedAssetView[];
      readonly result: ReorderAssetsResult;
    };

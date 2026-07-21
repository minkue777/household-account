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

export function decideAssetReorder(input: {
  readonly current: readonly OrderedAssetView[];
  readonly orderedAssetIds: readonly string[];
  readonly expectedVersions: Readonly<Record<string, number>>;
}): AssetOrderDecision {
  const currentIds = new Set(input.current.map((asset) => asset.assetId));
  const requestedIds = new Set(input.orderedAssetIds);
  const validSet =
    requestedIds.size === input.orderedAssetIds.length &&
    requestedIds.size === currentIds.size &&
    [...requestedIds].every((assetId) => currentIds.has(assetId));

  if (!validSet) {
    return {
      kind: "return",
      result: { kind: "validation-error", code: "INVALID_ORDER_SET" },
    };
  }

  if (
    input.current.some(
      (asset) => input.expectedVersions[asset.assetId] !== asset.aggregateVersion,
    )
  ) {
    return {
      kind: "return",
      result: {
        kind: "conflict",
        code: "ASSET_ORDER_VERSION_MISMATCH",
      },
    };
  }

  const byId = new Map(input.current.map((asset) => [asset.assetId, asset]));
  const assets = input.orderedAssetIds.map((assetId, order) => {
    const current = byId.get(assetId)!;
    return current.order === order
      ? { ...current }
      : { ...current, order, aggregateVersion: current.aggregateVersion + 1 };
  });

  return {
    kind: "commit",
    assets,
    result: { kind: "success", assets },
  };
}

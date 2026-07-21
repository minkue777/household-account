import type {
  AssetOwnerSelectorItem,
  AssetOwnerUiAction,
  AssetOwnerUiSurface,
} from "../../../domain/policies/assetOwnerUiSurfacePolicy";

export type {
  AssetOwnerSelectorItem,
  AssetOwnerUiAction,
  AssetOwnerUiSurface,
};

export interface VerifiedAssetOwnerUiActor {
  principalRef: string;
  capabilities: readonly string[];
}

export interface AssetOwnerUiSurfaceView {
  surface: AssetOwnerUiSurface;
  actions: readonly AssetOwnerUiAction[];
  selectorItems: readonly AssetOwnerSelectorItem[];
}

export interface AssetOwnerUiSurfaceInputPort {
  viewFor(
    actor: VerifiedAssetOwnerUiActor,
    surface: AssetOwnerUiSurface,
  ): Promise<AssetOwnerUiSurfaceView>;
}

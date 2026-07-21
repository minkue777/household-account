import type {
  AssetValuationChangedEvent,
  AssetView,
} from "../in/assetCreationInputPort";

export interface AssetOwnerProfileReference {
  readonly profileId: string;
  readonly householdId: string;
  readonly lifecycle: "active" | "archived";
}

export interface AssetOwnerProfileReferencePort {
  find(profileId: string): Promise<AssetOwnerProfileReference | undefined>;
}

export interface AssetCreationUnitOfWorkPort {
  commit(input: {
    readonly asset: AssetView;
    readonly event: AssetValuationChangedEvent;
  }): Promise<void>;
}

export interface AssetCreationIdPort {
  nextAssetId(): string;
}

export interface AssetCreationClockPort {
  now(): string;
}

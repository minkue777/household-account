import { AssetOwnerProfileState } from "../../../domain/model/assetOwnerProfile";

export interface AssetOwnerProfileMutation<T> {
  state: AssetOwnerProfileState;
  value: T;
}

export interface AssetOwnerProfileStorePort {
  read(): Promise<AssetOwnerProfileState>;
  transact<T>(
    operation: (
      current: AssetOwnerProfileState,
    ) => AssetOwnerProfileMutation<T>,
  ): Promise<T>;
}

export interface AssetOwnerProfileIdPort {
  nextDependentProfileId(idempotencyKey: string): string;
}

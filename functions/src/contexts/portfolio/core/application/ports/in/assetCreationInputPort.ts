import type {
  CreateAssetCommand,
  CreateAssetResult,
} from "../../../domain/model/assetCreation";

export type {
  AssetCurrency,
  AssetOwnerRef,
  AssetType,
  AssetValuationChangedEvent,
  AssetView,
  CreateAssetCommand,
  CreateAssetResult,
  CreateAssetValidationCode,
} from "../../../domain/model/assetCreation";

export interface AssetCreationInputPort {
  create(input: CreateAssetCommand): Promise<CreateAssetResult>;
}

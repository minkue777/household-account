import type {
  ApplyPermanentAssetPurgePageCommand,
  AssetLifecycleActor,
  AssetLifecycleCommandResult,
  AssetLifecycleView,
  DeleteAssetCommand,
  RequestPermanentAssetPurgeCommand,
  RestoreDeletedAssetCommand,
} from "../../../domain/model/assetLifecycle";

export type {
  ApplyPermanentAssetPurgePageCommand,
  AssetLifecycleActor,
  AssetLifecycleAuditRecord,
  AssetLifecycleCommandResult,
  AssetLifecycleEvent,
  AssetLifecycleOperation,
  AssetLifecycleReceipt,
  AssetLifecycleView,
  AssetPurgeCompletionView,
  AssetPurgePageOutcome,
  AssetPurgeParticipant,
  AssetPurgeParticipantProgress,
  AssetPurgeProcessView,
  CanonicalAssetLifecycle,
  DeleteAssetCommand,
  RequestPermanentAssetPurgeCommand,
  RestoreDeletedAssetCommand,
} from "../../../domain/model/assetLifecycle";

export type VisibleAssetResult =
  | { readonly kind: "success"; readonly asset: AssetLifecycleView }
  | { readonly kind: "no-data" }
  | { readonly kind: "forbidden"; readonly code: string };

export type DeletedAssetListResult =
  | { readonly kind: "success"; readonly assetIds: readonly string[] }
  | { readonly kind: "no-data" }
  | { readonly kind: "forbidden"; readonly code: string };

export interface AssetLifecycleInputPort {
  deleteAsset(command: DeleteAssetCommand): Promise<AssetLifecycleCommandResult>;
  restoreDeletedAsset(
    command: RestoreDeletedAssetCommand,
  ): Promise<AssetLifecycleCommandResult>;
  requestPermanentAssetPurge(
    command: RequestPermanentAssetPurgeCommand,
  ): Promise<AssetLifecycleCommandResult>;
  applyPermanentAssetPurgePage(
    command: ApplyPermanentAssetPurgePageCommand,
  ): Promise<AssetLifecycleCommandResult>;
  queryVisibleAsset(
    actor: AssetLifecycleActor,
    assetId: string,
  ): Promise<VisibleAssetResult>;
  listDeletedAssets(actor: AssetLifecycleActor): Promise<DeletedAssetListResult>;
}

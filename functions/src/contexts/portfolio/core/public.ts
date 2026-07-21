export {
  queryAssetHistory,
  type AssetHistoryPoint,
  type AssetHistoryQuery,
  type AssetHistoryQueryResult,
} from "./application/queries/assetHistory";
export type {
  AssetHistoryInputPort,
  QueryDimensionedAssetHistory,
} from "./application/ports/in/assetHistoryInputPort";
export type {
  AssetHistoryPointV1,
  AssetHistoryViewV1,
  AssetOwnerRefKey,
  QueryDimensionedAssetHistoryResult,
} from "./domain/model/dimensionedAssetHistory";
export type {
  AssetOrderInputPort,
  OrderedAssetView,
  ReorderAssetsCommand,
  ReorderAssetsResult,
} from "./application/ports/in/assetOrderInputPort";
export {
  calculatePortfolioTotalsPolicy as calculatePortfolioTotals,
  type PortfolioAssetFact,
  type PortfolioAssetLifecycleState,
  type PortfolioAssetType,
  type PortfolioOwnerRef,
  type PortfolioTotals,
  type PortfolioTotalsResult,
} from "./domain/policies/portfolioTotals";

export { createAssetSnapshotProjectionApplication } from "./application/assetSnapshotProjectionApplication";
export type { AssetSnapshotProjectionInputPort } from "./application/ports/in/assetSnapshotProjectionInputPort";
export type {
  AssetSnapshotProjectionResult,
  AssetSnapshotProjectionView,
  AssetSnapshotSourceView,
  PreviousAssetSnapshotView,
} from "./domain/model/assetSnapshotProjection";

export {
  normalizeCanonicalAssetSubType,
  normalizeLoanRepaymentMethod,
  type NormalizedAssetSubType,
} from "./domain/policies/legacyAssetNormalization";

export type {
  AssetCreationInputPort,
  AssetCurrency,
  AssetOwnerRef,
  AssetType,
  AssetValuationChangedEvent,
  AssetView,
  CreateAssetCommand,
  CreateAssetResult,
  CreateAssetValidationCode,
} from "./application/ports/in/assetCreationInputPort";

export type {
  ApplyPermanentAssetPurgePageCommand,
  AssetLifecycleActor,
  AssetLifecycleAuditRecord,
  AssetLifecycleCommandResult,
  AssetLifecycleEvent,
  AssetLifecycleInputPort,
  AssetLifecycleOperation,
  AssetLifecycleReceipt,
  AssetLifecycleView,
  AssetPurgeCompletionView,
  AssetPurgePageOutcome,
  AssetPurgeParticipant,
  AssetPurgeParticipantProgress,
  AssetPurgeProcessView,
  CanonicalAssetLifecycle,
  DeletedAssetListResult,
  DeleteAssetCommand,
  RequestPermanentAssetPurgeCommand,
  RestoreDeletedAssetCommand,
  VisibleAssetResult,
} from "./application/ports/in/assetLifecycleInputPort";

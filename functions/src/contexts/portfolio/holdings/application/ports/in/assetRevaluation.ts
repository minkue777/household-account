import type {
  RevaluationCommand,
  RevaluationPortfolioEvent,
  RevaluationResult,
  RevaluedAssetView,
  RevaluedPositionView,
} from "../../../domain/model/assetRevaluation";

export interface AssetRevaluationWorkflow {
  execute(command: RevaluationCommand): Promise<RevaluationResult>;
  queryAsset(assetId: string): Promise<RevaluedAssetView>;
  listPositions(assetId: string): Promise<readonly RevaluedPositionView[]>;
  recordedEvents(): readonly RevaluationPortfolioEvent[];
}

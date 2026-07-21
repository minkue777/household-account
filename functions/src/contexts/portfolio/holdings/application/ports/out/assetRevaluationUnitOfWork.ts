import type {
  RevaluationPortfolioEvent,
  RevaluationResult,
  RevaluationState,
  RevaluedAssetView,
  RevaluedPositionView,
} from "../../../domain/model/assetRevaluation";

export type RevaluationDecision =
  | { kind: "return"; result: RevaluationResult }
  | {
      kind: "commit";
      nextState: RevaluationState;
      events: readonly RevaluationPortfolioEvent[];
      result: RevaluationResult;
    };

export interface AssetRevaluationUnitOfWork {
  transact(
    decide: (state: RevaluationState) => RevaluationDecision,
  ): Promise<RevaluationResult>;
  asset(assetId: string): Promise<RevaluedAssetView>;
  positions(assetId: string): Promise<readonly RevaluedPositionView[]>;
  events(): readonly RevaluationPortfolioEvent[];
}

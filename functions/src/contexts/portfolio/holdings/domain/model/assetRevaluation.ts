export interface RevaluedAssetView {
  assetId: string;
  currentBalance: number;
  costBasis: number;
  aggregateVersion: number;
}

export interface RevaluedPositionView {
  positionId: string;
  assetId: string;
  quantity: number;
  averagePrice: number;
  evaluatedPrice: number;
  evaluatedAmount: number;
  aggregateVersion: number;
}

export interface RevaluationCommand {
  commandId: string;
  idempotencyKey: string;
  householdId: string;
  assetId: string;
  expectedAssetVersion: number;
  operation: "add" | "update" | "delete";
  positionId: string;
  expectedPositionVersion?: number;
  quantity?: number;
  averagePrice?: number;
  evaluatedPrice?: number;
}

export type RevaluationResult =
  | {
      kind: "success";
      asset: RevaluedAssetView;
      position?: RevaluedPositionView;
    }
  | {
      kind: "conflict";
      code:
        | "REVALUATION_VERSION_MISMATCH"
        | "IDEMPOTENCY_PAYLOAD_MISMATCH";
    }
  | { kind: "retryable-failure"; code: "UOW_RETRY_EXHAUSTED" };

export type RevaluationPortfolioEvent =
  | {
      eventType: "PositionChanged.v1";
      aggregateId: string;
      aggregateVersion: number;
      assetId: string;
    }
  | {
      eventType: "AssetValuationChanged.v1";
      aggregateId: string;
      aggregateVersion: number;
      currentSignedBalance: number;
    };

export interface RevaluationReceipt {
  fingerprint: string;
  result: RevaluationResult;
}

export interface RevaluationState {
  asset: RevaluedAssetView;
  positions: readonly RevaluedPositionView[];
  receipts: Readonly<Record<string, RevaluationReceipt>>;
}

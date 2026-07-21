export interface PositionState {
  positionId: string;
  assetId: string;
  quantity: number;
  averagePriceInWon: number;
  evaluatedPriceInWon: number;
  aggregateVersion: number;
}

export interface PositionAccountState {
  assetId: string;
  currentBalanceInWon: number;
  costBasisInWon: number;
  aggregateVersion: number;
}

export interface PositionMutationReceipt {
  commandId: string;
  idempotencyKey: string;
  operation: "update" | "delete";
  positionId: string;
  resultingAssetVersion: number;
  resultingPositionVersion?: number;
}

export type PositionMutationEvent =
  | {
      eventType: "PositionChanged.v1";
      operation: "updated";
      positionId: string;
      aggregateVersion: number;
    }
  | {
      eventType: "PositionRemoved.v1";
      positionId: string;
      aggregateVersion: number;
    }
  | {
      eventType: "AssetValuationChanged.v1";
      assetId: string;
      aggregateVersion: number;
      currentSignedBalance: number;
      costBasisInWon: number;
    };

export type PositionMutationResult =
  | {
      kind: "success";
      asset: PositionAccountState;
      position?: PositionState;
      receipt: PositionMutationReceipt;
    }
  | {
      kind: "conflict";
      code: "POSITION_VERSION_MISMATCH" | "ASSET_VERSION_MISMATCH";
    }
  | { kind: "retryable-failure"; code: "PORTFOLIO_UOW_FAILED" };

export interface UpdatePositionCommand {
  commandId: string;
  idempotencyKey: string;
  householdId: string;
  assetId: string;
  positionId: string;
  expectedAssetVersion: number;
  expectedPositionVersion: number;
  quantity: number;
  averagePriceInWon: number;
  evaluatedPriceInWon: number;
}

export interface DeletePositionCommand {
  commandId: string;
  idempotencyKey: string;
  householdId: string;
  assetId: string;
  positionId: string;
  expectedAssetVersion: number;
  expectedPositionVersion: number;
}

export interface PositionMutationState {
  asset: PositionAccountState;
  positions: readonly PositionState[];
  receipts: Readonly<Record<string, PositionMutationResult>>;
}

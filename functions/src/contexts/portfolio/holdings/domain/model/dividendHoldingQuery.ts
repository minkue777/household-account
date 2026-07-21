export interface DividendHoldingPositionView {
  readonly householdId: string;
  readonly assetId: string;
  readonly positionId: string;
  readonly instrument: {
    readonly market: "KRX";
    readonly instrumentType: "ETF";
    readonly code: string;
    readonly name: string;
    readonly currency: "KRW";
  };
  readonly quantity: number;
  readonly aggregateVersion: number;
  readonly updatedAt: string;
}

export interface DividendHoldingTargetView {
  readonly targetId: string;
  readonly householdId: string;
  readonly instrument: DividendHoldingPositionView["instrument"];
  readonly sourceAssetIds: readonly string[];
}

export interface DividendPositionHistoryView {
  readonly householdId: string;
  readonly assetId: string;
  readonly positionId: string;
  readonly instrumentCode: string;
  readonly snapshotDate: string;
  readonly quantity: number;
  readonly observedAt: string;
  readonly sourceVersion: string;
}

export interface DividendHoldingTargetPage {
  readonly items: readonly DividendHoldingTargetView[];
  readonly nextCursor?: string;
}

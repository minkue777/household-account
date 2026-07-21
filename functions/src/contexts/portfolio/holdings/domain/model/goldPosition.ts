export interface GoldPositionView {
  positionId: string;
  kind: "physical-gold" | "gold-etf";
  normalizedQuantity: number;
  evaluatedAmountInWon: number;
  quoteObservedAt?: string;
}

export type GoldProviderResult =
  | { kind: "success"; wonPerDon: number; observedAt: string }
  | { kind: "retryable-failure"; code: string }
  | { kind: "contract-failure"; code: string }
  | { kind: "fixed-fallback"; wonPerDon: number };

export type RefreshGoldResult =
  | { kind: "success"; value: GoldPositionView }
  | {
      kind: "partial-failure" | "contract-failure";
      code: string;
      retained: GoldPositionView;
    };

export interface GoldValuationEvent {
  eventType: "PositionChanged.v1" | "AssetValuationChanged.v1";
}

export interface NormalizeGoldInput {
  positionId: string;
  kind: "physical-gold" | "gold-etf";
  quantity?: number;
  legacyMemo?: string;
  quoteInWon: number;
}

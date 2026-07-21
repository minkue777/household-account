export type PositionKind =
  | "stock"
  | "etf"
  | "etn"
  | "fund"
  | "cash"
  | "manual"
  | "crypto"
  | "physical-gold";

export interface QuoteObservation {
  priceInWon: number;
  observedAt: string;
  provider: string;
}

export interface PositionValuationInput {
  positionId: string;
  kind: PositionKind;
  quantity: number;
  averagePrice?: number;
  priceScale: number;
  lastQuote?: QuoteObservation;
}

export interface PositionValuation {
  positionId: string;
  evaluatedPriceSource: "quote" | "average-price";
  evaluatedPriceInWon: number;
  evaluatedAmountInWon: number;
  costBasisInWon: number;
  quoteObservedAt?: string;
}

export type MarketResult =
  | { kind: "success"; quote: QuoteObservation }
  | { kind: "no-data"; code: string }
  | { kind: "retryable-failure"; code: string }
  | { kind: "contract-failure"; code: string };

export type PositionValuationResult =
  | { kind: "success"; value: PositionValuation }
  | {
      kind: "validation-error";
      code: "INVALID_QUANTITY" | "INVALID_AVERAGE_PRICE" | "INVALID_PRICE_SCALE";
    };

export type RefreshedPositionResult =
  | { kind: "success"; value: PositionValuation; lastQuote: QuoteObservation }
  | {
      kind: "partial-failure";
      code: string;
      retryable: boolean;
      value: PositionValuation;
      lastQuote?: QuoteObservation;
    };

export interface HoldingAccountValuation {
  currentBalance: number;
  costBasis: number;
}

export type HoldingAccountValuationResult =
  | { kind: "success"; value: HoldingAccountValuation }
  | { kind: "validation-error"; code: string };

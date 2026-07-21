import {
  calculateAccountValuationPolicy,
  type AccountValuation,
  type ValuationPosition,
} from "./domain/policies/accountValuation";

export type { AccountValuation, ValuationPosition };

export function calculateAccountValuation(
  positions: readonly ValuationPosition[],
): AccountValuation {
  return calculateAccountValuationPolicy(positions);
}

export {
  searchFundInstruments,
  selectOfficialFundNav,
  valueFundPosition,
  type FundInstrumentView,
  type FundNavObservation,
  type FundNavResult,
  type FundSearchResult,
  type FundValuationResult,
  type SelectOfficialFundNavInput,
  type ValueFundPositionInput,
} from "./domain/policies/fundInstrumentNav";

export type { InstrumentSearch } from "./application/ports/in/instrumentSearch";
export type {
  CatalogInstrument,
  InstrumentMarket,
  InstrumentSearchResult,
  InstrumentType,
  SearchInstrument,
} from "./domain/model/instrumentSearch";

export type { InstrumentCatalog } from "./application/ports/in/instrumentCatalog";
export type {
  CatalogManifest,
  CatalogPublicationState,
  CatalogSnapshot,
  PublishCatalogCommand,
  PublishCatalogResult,
  ReadCatalogQuery,
  ReadCatalogResult,
} from "./domain/model/instrumentCatalog";

export type { MarketRouting } from "./application/ports/in/marketRouting";
export type {
  MarketInstrumentRef,
  MarketRouteResult,
  NormalizedMarketQuote,
} from "./domain/model/marketRouting";

export type { HoldingValuation } from "./application/ports/in/holdingValuation";
export type {
  HoldingAccountValuation,
  HoldingAccountValuationResult,
  MarketResult,
  PositionKind,
  PositionValuation,
  PositionValuationInput,
  PositionValuationResult,
  QuoteObservation,
  RefreshedPositionResult,
} from "./domain/model/holdingValuation";

export type { GoldPosition } from "./application/ports/in/goldPosition";
export type {
  GoldPositionView,
  GoldProviderResult,
  GoldValuationEvent,
  NormalizeGoldInput,
  RefreshGoldResult,
} from "./domain/model/goldPosition";

export type { ForeignCurrencyValuation } from "./application/ports/in/foreignCurrencyValuation";
export type {
  ExchangeRateObservation,
  ForeignCurrencyValuationEvent,
  ProviderHealthView,
  ProviderSelectionEvidence,
  RefreshForeignCurrencyValuationCommand,
  RefreshForeignCurrencyValuationResult,
  SourceQuoteObservation,
  WonValuationQuote,
} from "./domain/model/foreignCurrencyValuation";

export type { DailyAssetValuation } from "./application/ports/in/dailyAssetValuation";
export type {
  AssetSnapshotIntentView,
  DailyAssetValuationChangedEvent,
  DailyTargetValuationResult,
  DailyValuationRunView,
  DailyValuationTarget,
  RunDailyAssetValuationCommand,
  ValuationMarket,
} from "./domain/model/dailyAssetValuation";

export type { DailyValuationRecovery } from "./application/ports/in/dailyValuationRecovery";
export type {
  DailyValuationRecoveryEvent,
  DailyValuationRecoveryRunView,
  LegacyValuationAsset,
  NormalizedValuationAsset,
  RecoveryProviderOutcome,
  RunDailyValuationRecoveryCommand,
} from "./domain/model/dailyValuationRecovery";

export type { AssetValuationTriggerScope } from "./application/ports/in/assetValuationTriggerScope";
export type {
  ScopedProviderResult,
  ScopedValuationRunResult,
  ScopedValuationTarget,
  ValuationChildReceipt,
  ValuationHousehold,
} from "./domain/model/assetValuationTriggerScope";

export type { AssetRevaluationWorkflow } from "./application/ports/in/assetRevaluation";
export type {
  RevaluationCommand,
  RevaluationPortfolioEvent,
  RevaluationResult,
  RevaluedAssetView,
  RevaluedPositionView,
} from "./domain/model/assetRevaluation";

export type { PositionMutationLifecycle } from "./application/ports/in/positionMutationLifecycle";
export type {
  DeletePositionCommand,
  PositionAccountState,
  PositionMutationEvent,
  PositionMutationReceipt,
  PositionMutationResult,
  PositionState,
  UpdatePositionCommand,
} from "./domain/model/positionMutation";

export type { HoldingInstrumentCandidate } from "./domain/model/holdingInstrumentCandidate";

export type { DividendHoldingQuery } from "./application/ports/in/dividendHoldingQuery";
export type {
  DividendHoldingPositionView,
  DividendHoldingTargetPage,
  DividendHoldingTargetView,
  DividendPositionHistoryView,
} from "./domain/model/dividendHoldingQuery";

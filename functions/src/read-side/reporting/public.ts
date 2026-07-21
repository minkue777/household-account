import {
  selectInitialTrendCategories,
  type TrendCategory,
} from "./trendCategorySelection";
export {
  resolveStatisticsPeriod,
  type ResolveStatisticsPeriodResult,
  type StatisticsPeriodInput,
  type StatisticsPeriodPreset,
} from "./statisticsPeriod";
export {
  queryAssetStatisticsPeriod,
  type AssetPeriodPreset,
  type AssetStatisticsPoint,
  type AssetStatisticsResult,
  type ReportingAssetType,
} from "./assetStatisticsPeriod";
export {
  type AssetSnapshotContinuityQuery,
} from "./application/queries/getAssetSnapshotContinuity";
export {
  type AssetSnapshotContinuityResult,
  type AssetStatisticsView,
} from "./calculations/assetSnapshotContinuity";
export { type LedgerStatisticsQuery } from "./application/queries/getLedgerStatistics";
export {
  type LedgerStatisticsFact,
  type LedgerStatisticsResult,
  type LedgerStatisticsView,
  type ReportingCategoryReference,
  type ReportingTransactionStatus,
} from "./model/ledgerStatistics";
export { type BoundedReportingQuery } from "./application/queries/boundedReportingQuery";
export {
  type BoundedLedgerSourceResponse,
  type BoundedReportingResult,
  type BoundedReportingView,
  type ReportingRequestIdentity,
} from "./model/boundedReporting";
export {
  type ReportingCategoryActionController,
} from "./application/reportingCategoryActionController";
export {
  type ReportingCategoryAction,
  type ReportingCategoryActionResult,
  type ReportingCategoryDetailRow,
  type ReportingUpstreamActionResult,
} from "./model/reportingCategoryAction";
export {
  type ReportingAuthoritativeActionController,
} from "./application/reportingAuthoritativeActionController";
export {
  type ReportingAuthoritativeState,
  type ReportingMerchantRuleView,
  type ReportingOwnedAction,
  type ReportingOwnedActionResult,
  type ReportingTransactionView,
  type ReportingUpstreamEvent,
  type ReportingUpstreamReceipt,
} from "./model/reportingAuthoritativeAction";
export {
  type BoundedAssetStatisticsQuery,
} from "./application/queries/boundedAssetStatisticsQuery";
export {
  type AssetSnapshotFact,
  type AssetSnapshotSourcePage,
  type AssetStatisticsResultView,
  type BoundedAssetStatisticsResult,
} from "./model/boundedAssetStatistics";
export {
  createHistoricalAssetDimensionsQuery,
  type HistoricalAssetDimensionsQuery,
  type HistoricalAssetDimensionsSeed,
  type HistoricalAssetSnapshot,
  type HistoricalAssetStatisticsResult,
  type HistoricalOwnerRefKey,
} from "./historicalAssetDimensions";

export interface TrendCategorySelectionInput {
  categories: readonly TrendCategory[];
  compatibilityDefaults: readonly string[];
}

export interface TrendCategorySelection {
  initialSelection(): readonly string[];
  toggle(categoryId: string): readonly string[];
  reload(): readonly string[];
}

export function createTrendCategorySelection(
  input: TrendCategorySelectionInput,
): TrendCategorySelection {
  const initial = selectInitialTrendCategories(
    input.categories,
    input.compatibilityDefaults,
  );
  let current = [...initial];

  return {
    initialSelection: () => [...initial],
    toggle: (categoryId) => {
      current = current.includes(categoryId)
        ? current.filter((selectedId) => selectedId !== categoryId)
        : [...current, categoryId];
      return [...current];
    },
    reload: () => {
      current = [...initial];
      return [...current];
    },
  };
}

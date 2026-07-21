import type { QueryDimensionedAssetHistoryResult } from "../../../domain/model/dimensionedAssetHistory";

export interface QueryDimensionedAssetHistory {
  householdId: string;
  period: { startDate: string; endDate: string };
}

export interface AssetHistoryInputPort {
  queryHistory(
    input: QueryDimensionedAssetHistory,
  ): Promise<QueryDimensionedAssetHistoryResult>;
}

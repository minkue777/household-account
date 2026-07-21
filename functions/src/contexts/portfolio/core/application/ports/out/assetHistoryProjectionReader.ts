import type { AssetHistoryProjectionSource } from "../../../domain/model/dimensionedAssetHistory";

export interface AssetHistoryProjectionReader {
  read(input: {
    householdId: string;
    period: { startDate: string; endDate: string };
  }): Promise<AssetHistoryProjectionSource>;
}

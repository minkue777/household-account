import { calculateAssetSnapshotContinuity, type AssetSnapshotContinuityResult } from "../../calculations/assetSnapshotContinuity";
import type { AssetSnapshotSourcePort } from "../ports/assetSnapshotSource";

export interface AssetSnapshotContinuityQuery {
  getStatistics(input: {
    householdId: string;
    memberId: string;
    period: { startDate: string; endDate: string };
  }): Promise<AssetSnapshotContinuityResult>;
}

export function createAssetSnapshotContinuityQuery(
  source: AssetSnapshotSourcePort,
): AssetSnapshotContinuityQuery {
  return {
    getStatistics: async (input) => {
      const result = await source.read(input);
      if (result.kind !== "ready") return result;
      return calculateAssetSnapshotContinuity({
        source: result,
        period: input.period,
      });
    },
  };
}

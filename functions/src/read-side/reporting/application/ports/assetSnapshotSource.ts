import type { AssetSnapshotSourceResult } from "../../model/assetSnapshot";

export type { AssetSnapshotSourceResult } from "../../model/assetSnapshot";

export interface AssetSnapshotSourcePort {
  read(input: {
    householdId: string;
    memberId: string;
    period: { startDate: string; endDate: string };
  }): Promise<AssetSnapshotSourceResult>;
}

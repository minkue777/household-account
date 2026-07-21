import { createAssetSnapshotContinuityQuery } from "../../src/read-side/reporting/application/queries/getAssetSnapshotContinuity";
import type {
  AssetSnapshotSourcePort,
  AssetSnapshotSourceResult,
} from "../../src/read-side/reporting/application/ports/assetSnapshotSource";
import type { AssetSnapshotContinuityQuery } from "../../src/read-side/reporting/public";

export function createAssetSnapshotContinuityFixtureSubject(
  sourceResult: AssetSnapshotSourceResult,
): AssetSnapshotContinuityQuery {
  const source: AssetSnapshotSourcePort = {
    read: async () => sourceResult,
  };
  return createAssetSnapshotContinuityQuery(source);
}

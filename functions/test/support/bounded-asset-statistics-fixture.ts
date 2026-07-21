import { createBoundedAssetStatisticsQuery } from "../../src/read-side/reporting/application/queries/boundedAssetStatisticsQuery";
import type { BoundedAssetSnapshotSourcePort } from "../../src/read-side/reporting/application/ports/boundedAssetSnapshotSource";
import type {
  AssetSnapshotSourceResult,
  AssetStatisticsSourceRequest,
} from "../../src/read-side/reporting/model/boundedAssetStatistics";

export function createBoundedAssetStatisticsFixtureSubject(fixture: {
  source: AssetSnapshotSourceResult;
  maxRows: number;
  maxPages: number;
  pageLimit: number;
}) {
  const requests: AssetStatisticsSourceRequest[] = [];
  const source: BoundedAssetSnapshotSourcePort = {
    load: async (request) => {
      requests.push(request);
      return fixture.source;
    },
  };
  const query = createBoundedAssetStatisticsQuery({
    source,
    maxRows: fixture.maxRows,
    maxPages: fixture.maxPages,
    pageLimit: fixture.pageLimit,
  });
  return {
    ...query,
    sourceRequestReceipts: () =>
      requests.map(({ memberId: _memberId, ...request }) => request),
  };
}

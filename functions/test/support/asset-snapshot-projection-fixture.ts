import { createAssetSnapshotProjectionApplication } from "../../src/contexts/portfolio/core/application/assetSnapshotProjectionApplication";
import type {
  AssetSnapshotProjectionStorePort,
  AssetSnapshotProjectionSourcePort,
} from "../../src/contexts/portfolio/core/application/ports/out/assetSnapshotProjectionPorts";
import type {
  AssetSnapshotProjectionView,
  AssetSnapshotSourceView,
  PreviousAssetSnapshotView,
} from "../../src/contexts/portfolio/core/domain/model/assetSnapshotProjection";

export function createAssetSnapshotProjectionFixture(input: {
  readonly current: AssetSnapshotSourceView;
  readonly previous?: PreviousAssetSnapshotView;
}) {
  let stored: AssetSnapshotProjectionView | undefined;
  let writeCount = 0;
  const source: AssetSnapshotProjectionSourcePort = {
    async readCurrent() {
      return input.current;
    },
  };
  const store: AssetSnapshotProjectionStorePort = {
    async latestBefore() {
      return input.previous;
    },
    async upsert(snapshot) {
      if (
        stored !== undefined &&
        JSON.stringify(stored) === JSON.stringify(snapshot)
      ) {
        return "replayed";
      }
      stored = structuredClone(snapshot);
      writeCount += 1;
      return "projected";
    },
  };
  return {
    subject: createAssetSnapshotProjectionApplication({ source, store }),
    snapshot: () =>
      stored === undefined ? undefined : structuredClone(stored),
    writeCount: () => writeCount,
  };
}

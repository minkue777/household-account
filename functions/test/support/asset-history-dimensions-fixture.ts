import { createAssetHistoryApplication } from "../../src/contexts/portfolio/core/application/assetHistoryApplication";
import type { AssetHistoryProjectionReader } from "../../src/contexts/portfolio/core/application/ports/out/assetHistoryProjectionReader";
import type {
  AssetHistoryPointV1,
  AssetHistoryProjectionSource,
  AssetOwnerRefKey,
} from "../../src/contexts/portfolio/core/domain/model/dimensionedAssetHistory";

type FixtureSource =
  | {
      kind: "ready";
      baseline?: AssetHistoryPointV1;
      window: readonly AssetHistoryPointV1[];
      sourceCheckpoint: string;
      updatedAt?: string;
      freshness?: "fresh" | "stale" | "rebuilding";
    }
  | Exclude<AssetHistoryProjectionSource, { kind: "ready" }>;

export interface AssetHistoryDimensionSeed {
  source: FixtureSource;
  currentAssets: readonly {
    assetId: string;
    type: string;
    ownerRefKey: AssetOwnerRefKey;
    lifecycle: "active" | "deleted";
  }[];
  ownerProfiles: readonly {
    ownerRefKey: AssetOwnerRefKey;
    lifecycle: "active" | "archived";
  }[];
}

const DEFAULT_UPDATED_AT = "2026-07-20T00:00:00.000Z";

export function createAssetHistoryDimensionFixture(
  seed: AssetHistoryDimensionSeed,
) {
  const projectionReader: AssetHistoryProjectionReader = {
    async read() {
      if (seed.source.kind !== "ready") return seed.source;
      return {
        ...seed.source,
        updatedAt: seed.source.updatedAt ?? DEFAULT_UPDATED_AT,
        freshness: seed.source.freshness ?? "fresh",
      };
    },
  };

  return createAssetHistoryApplication({ projectionReader });
}

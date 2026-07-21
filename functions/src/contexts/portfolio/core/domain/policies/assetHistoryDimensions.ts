import type {
  AssetHistoryPointV1,
  AssetHistoryProjectionSource,
  AssetHistoryViewV1,
  AssetOwnerRefKey,
} from "../model/dimensionedAssetHistory";

function clonePoint(point: AssetHistoryPointV1): AssetHistoryPointV1 {
  return {
    ...point,
    byType: { ...point.byType },
    byOwnerRefKey: { ...point.byOwnerRefKey },
  };
}

export function buildDimensionedAssetHistory(
  source: Extract<AssetHistoryProjectionSource, { kind: "ready" }>,
): AssetHistoryViewV1 {
  const byDate = new Map<string, AssetHistoryPointV1>();
  if (source.baseline !== undefined) {
    byDate.set(source.baseline.localDate, clonePoint(source.baseline));
  }
  for (const point of source.window) {
    byDate.set(point.localDate, clonePoint(point));
  }

  const points = [...byDate.values()].sort((left, right) =>
    left.localDate.localeCompare(right.localDate),
  );
  const typeKeys = new Set<string>();
  const ownerRefKeys = new Set<AssetOwnerRefKey>();

  for (const point of points) {
    for (const key of Object.keys(point.byType)) typeKeys.add(key);
    for (const key of Object.keys(point.byOwnerRefKey)) {
      ownerRefKeys.add(key as AssetOwnerRefKey);
    }
  }

  return {
    schemaVersion: 1,
    points,
    dimensions: {
      typeKeys: [...typeKeys].sort(),
      ownerRefKeys: [...ownerRefKeys].sort(),
    },
    sourceCheckpoint: source.sourceCheckpoint,
    updatedAt: source.updatedAt,
    freshness: source.freshness,
  };
}

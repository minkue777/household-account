import type { PositionSnapshot } from "../model/dividendLifecycle";

function localDateDistance(left: string, right: string): number {
  const leftTime = Date.parse(`${left}T00:00:00Z`);
  const rightTime = Date.parse(`${right}T00:00:00Z`);
  return Math.abs(leftTime - rightTime);
}

export function positionHistoryFailure(
  sourceAssetIds: readonly string[],
  evidence: readonly { readonly assetId: string; readonly quantity: number }[],
): "POSITION_HISTORY_NOT_OBSERVED" | "POSITION_HISTORY_INCOMPLETE" | undefined {
  if (evidence.length === 0) return "POSITION_HISTORY_NOT_OBSERVED";
  const required = new Set(sourceAssetIds);
  const observed = new Set(evidence.filter(item => Number.isFinite(item.quantity) && item.quantity >= 0).map(item => item.assetId));
  return observed.size === required.size && evidence.length === required.size &&
    [...required].every(assetId => observed.has(assetId)) ? undefined : "POSITION_HISTORY_INCOMPLETE";
}

export function selectNearestPositionSnapshots(input: {
  instrumentCode: string;
  recordDate: string;
  snapshots: readonly PositionSnapshot[];
}): readonly PositionSnapshot[] {
  const grouped = new Map<string, PositionSnapshot[]>();
  for (const snapshot of input.snapshots) {
    if (snapshot.instrumentCode !== input.instrumentCode) continue;
    const values = grouped.get(snapshot.assetId) ?? [];
    values.push(snapshot);
    grouped.set(snapshot.assetId, values);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([_assetId, snapshots]) => {
      const selected = [...snapshots].sort((left, right) => {
        const distance =
          localDateDistance(left.snapshotDate, input.recordDate) -
          localDateDistance(right.snapshotDate, input.recordDate);
        if (distance !== 0) return distance;
        const earlierPreference = left.snapshotDate.localeCompare(
          right.snapshotDate,
        );
        if (earlierPreference !== 0) return earlierPreference;
        return right.observedAt.localeCompare(left.observedAt);
      })[0];
      return selected === undefined ? [] : [{ ...selected }];
    });
}

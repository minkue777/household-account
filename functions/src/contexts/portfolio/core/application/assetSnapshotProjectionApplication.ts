import { calculatePortfolioTotalsPolicy } from "../domain/policies/portfolioTotals";
import type { AssetSnapshotProjectionInputPort } from "./ports/in/assetSnapshotProjectionInputPort";
import type {
  AssetSnapshotProjectionSourcePort,
  AssetSnapshotProjectionStorePort,
} from "./ports/out/assetSnapshotProjectionPorts";

function withPreviousKeys(
  current: Readonly<Record<string, number>>,
  previous: Readonly<Record<string, number>> | undefined,
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    [...new Set([...Object.keys(previous ?? {}), ...Object.keys(current)])]
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, current[key] ?? 0]),
  );
}

function retainedOwnerNames(input: {
  current: Readonly<Record<string, string>>;
  previous: Readonly<Record<string, string>> | undefined;
  ownerKeys: readonly string[];
}): Readonly<Record<string, string>> {
  return Object.fromEntries(
    input.ownerKeys.map((key) => [
      key,
      input.current[key] ?? input.previous?.[key] ?? key,
    ]),
  );
}

export function createAssetSnapshotProjectionApplication(dependencies: {
  readonly source: AssetSnapshotProjectionSourcePort;
  readonly store: AssetSnapshotProjectionStorePort;
}): AssetSnapshotProjectionInputPort {
  return {
    async project(input) {
      try {
        const [source, previous] = await Promise.all([
          dependencies.source.readCurrent(input.householdId),
          dependencies.store.latestBefore({
            householdId: input.householdId,
            localDate: input.localDate,
          }),
        ]);
        const totals = calculatePortfolioTotalsPolicy({
          assets: source.assets,
          calculatedAt: input.calculatedAt,
        });
        if (totals.kind === "validation-error") return totals;

        const byType = withPreviousKeys(totals.value.byType, previous?.byType);
        const byOwnerRefKey = withPreviousKeys(
          totals.value.byOwnerRefKey,
          previous?.byOwnerRefKey,
        );
        const snapshot = {
          ...totals.value,
          schemaVersion: 1 as const,
          householdId: input.householdId,
          localDate: input.localDate,
          byType,
          byOwnerRefKey,
          ownerDisplayNames: retainedOwnerNames({
            current: source.ownerDisplayNames,
            previous: previous?.ownerDisplayNames,
            ownerKeys: Object.keys(byOwnerRefKey),
          }),
          sourceCheckpoint: input.sourceCheckpoint,
        };
        const kind = await dependencies.store.upsert(snapshot);
        return kind === "projected"
          ? { kind: "projected", snapshot }
          : { kind: "replayed", snapshot };
      } catch {
        return {
          kind: "retryable-failure",
          code: "SNAPSHOT_REBUILD_RETRYABLE",
        };
      }
    },
  };
}

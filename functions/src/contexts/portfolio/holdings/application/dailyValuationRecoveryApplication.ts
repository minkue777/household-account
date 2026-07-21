import type { DailyValuationRecoveryRunView } from "../domain/model/dailyValuationRecovery";
import type { DailyValuationRecovery } from "./ports/in/dailyValuationRecovery";
import type { DailyValuationRecoveryStore } from "./ports/out/dailyValuationRecoveryStore";

export function createDailyValuationRecoveryApplication(
  store: DailyValuationRecoveryStore,
): DailyValuationRecovery {
  return {
    async run(command) {
      const replay = store.receipt(command.runId);
      if (replay !== undefined) return replay;

      const assets = store.assets();
      const excludedDeleted = assets
        .filter(({ normalizedLifecycle }) => normalizedLifecycle === "deleted")
        .map(({ assetId }) => assetId);
      const succeeded: string[] = [];
      const retryableFailed: { assetId: string; code: string }[] = [];
      const updates: {
        assetId: string;
        expectedVersion: number;
        valueInWon: number;
      }[] = [];

      for (const asset of assets) {
        if (asset.normalizedLifecycle === "deleted") continue;
        const outcome = command.outcomes[asset.assetId];
        if (outcome === undefined) continue;
        const expectedVersion = command.expectedVersions[asset.assetId];
        if (expectedVersion !== asset.aggregateVersion) {
          retryableFailed.push({
            assetId: asset.assetId,
            code: "ASSET_VERSION_MISMATCH",
          });
          continue;
        }
        if (outcome.kind === "retryable-failure") {
          retryableFailed.push({ assetId: asset.assetId, code: outcome.code });
          continue;
        }
        succeeded.push(asset.assetId);
        updates.push({
          assetId: asset.assetId,
          expectedVersion,
          valueInWon: outcome.valueInWon,
        });
      }

      const result: DailyValuationRecoveryRunView = {
        kind: retryableFailed.length === 0 ? "complete" : "partial-failure",
        succeeded,
        retryableFailed,
        excludedDeleted,
      };
      const events = updates.map(({ assetId, valueInWon }) => ({
        eventType: "AssetValuationChanged.v1" as const,
        assetId,
        currentSignedBalance: valueInWon,
      }));
      const committed = store.commit({
        runId: command.runId,
        result,
        updates,
        events,
      });
      if (committed === "version-conflict") {
        return {
          kind: "partial-failure",
          succeeded: [],
          retryableFailed: updates.map(({ assetId }) => ({
            assetId,
            code: "ASSET_VERSION_MISMATCH",
          })),
          excludedDeleted,
        };
      }
      return result;
    },
    currentAssets: () => store.assets(),
    recordedEvents: () => store.events(),
  };
}

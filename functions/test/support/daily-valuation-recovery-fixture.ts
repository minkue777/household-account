import { createDailyValuationRecoveryApplication } from "../../src/contexts/portfolio/holdings/application/dailyValuationRecoveryApplication";
import type { DailyValuationRecoveryStore } from "../../src/contexts/portfolio/holdings/application/ports/out/dailyValuationRecoveryStore";
import { normalizeValuationAssetLifecycle } from "../../src/contexts/portfolio/holdings/domain/policies/assetLifecycleNormalization";
import type {
  DailyValuationRecoveryEvent,
  DailyValuationRecoveryRunView,
  LegacyValuationAsset,
  NormalizedValuationAsset,
} from "../../src/contexts/portfolio/holdings/public";

export function createDailyValuationRecoveryFixture(seed: {
  assets: readonly LegacyValuationAsset[];
}) {
  let assets: NormalizedValuationAsset[] = seed.assets.map(
    normalizeValuationAssetLifecycle,
  );
  const receipts = new Map<string, DailyValuationRecoveryRunView>();
  const events: DailyValuationRecoveryEvent[] = [];
  const store: DailyValuationRecoveryStore = {
    receipt: (runId) => receipts.get(runId),
    assets: () => assets.map((asset) => ({ ...asset })),
    commit: (input) => {
      for (const update of input.updates) {
        const current = assets.find(({ assetId }) => assetId === update.assetId);
        if (current?.aggregateVersion !== update.expectedVersion) {
          return "version-conflict";
        }
      }
      assets = assets.map((asset) => {
        const update = input.updates.find(
          ({ assetId }) => assetId === asset.assetId,
        );
        return update === undefined
          ? asset
          : {
              ...asset,
              currentBalance: update.valueInWon,
              aggregateVersion: asset.aggregateVersion + 1,
            };
      });
      receipts.set(input.runId, input.result);
      events.push(...input.events.map((event) => ({ ...event })));
      return "committed";
    },
    events: () => events.map((event) => ({ ...event })),
  };
  return createDailyValuationRecoveryApplication(store);
}

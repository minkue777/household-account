import { createDailyAssetValuationApplication } from "../../src/contexts/portfolio/holdings/application/dailyAssetValuationApplication";
import type {
  DailyAssetValuationClock,
  DailyAssetValuationStore,
  DailyValuationProvider,
  DailyValuationTargetReader,
} from "../../src/contexts/portfolio/holdings/application/ports/out/dailyAssetValuationPorts";
import type {
  AssetSnapshotIntentView,
  DailyAssetValuationChangedEvent,
  DailyTargetValuationResult,
  DailyValuationRunView,
  DailyValuationTarget,
} from "../../src/contexts/portfolio/holdings/public";

interface SeedTarget extends DailyValuationTarget {
  providerResult: DailyTargetValuationResult;
}

function copyRun(run: DailyValuationRunView): DailyValuationRunView {
  return {
    ...run,
    pageReceipts: run.pageReceipts.map((page) => ({
      ...page,
      targetIds: [...page.targetIds],
    })),
    succeeded: [...run.succeeded],
    retryableFailed: run.retryableFailed.map((failure) => ({ ...failure })),
  };
}

export function createDailyAssetValuationFixture(seed: {
  targets: readonly SeedTarget[];
  previousSnapshotScopes?: {
    byType: Readonly<Record<string, number>>;
    byOwnerRefKey: Readonly<Record<string, number>>;
  };
  fixedCreatedAt: string;
}) {
  const targets = seed.targets.map(({ providerResult: _providerResult, ...target }) => ({
    ...target,
  }));
  const providerResults = new Map(
    seed.targets.map(({ targetId, providerResult }) => [targetId, providerResult]),
  );
  const runs: DailyValuationRunView[] = [];
  const receipts = new Map<string, DailyValuationRunView>();
  const pageRuns: { householdId: string; requestedAt: string; run: DailyValuationRunView }[] = [];
  let assetValues: Readonly<Record<string, number>> = Object.fromEntries(
    seed.targets.map(({ assetId, previousSuccessfulValue }) => [
      assetId,
      previousSuccessfulValue,
    ]),
  );
  const snapshots = new Map<string, AssetSnapshotIntentView>();
  const events: DailyAssetValuationChangedEvent[] = [];

  const targetReader: DailyValuationTargetReader = {
    listAll: async () => targets.map((target) => ({ ...target })),
    previousSnapshotScopes: () => seed.previousSnapshotScopes,
  };
  const provider: DailyValuationProvider = {
    value: async (target) =>
      providerResults.get(target.targetId) ?? {
        kind: "retryable-failure",
        code: "VALUATION_RESULT_MISSING",
      },
  };
  const clock: DailyAssetValuationClock = { now: () => seed.fixedCreatedAt };
  const store: DailyAssetValuationStore = {
    findByIdempotencyKey: (key) => {
      const run = receipts.get(key);
      return run === undefined ? undefined : copyRun(run);
    },
    findRecentPageRun: ({ householdId, requestedAt, withinMilliseconds }) => {
      const requested = Date.parse(requestedAt);
      const match = [...pageRuns]
        .reverse()
        .find(
          (entry) =>
            entry.householdId === householdId &&
            requested - Date.parse(entry.requestedAt) >= 0 &&
            requested - Date.parse(entry.requestedAt) <= withinMilliseconds,
        );
      return match === undefined ? undefined : copyRun(match.run);
    },
    commit: (input) => {
      const storedRun = copyRun(input.run);
      runs.push(storedRun);
      if (input.idempotencyKey !== undefined) {
        receipts.set(input.idempotencyKey, storedRun);
      }
      if (input.pageEntry !== undefined) {
        pageRuns.push({ ...input.pageEntry, run: storedRun });
      }
      assetValues = { ...input.assetValues };
      snapshots.set(input.snapshot.localDate, {
        ...input.snapshot,
        byType: { ...input.snapshot.byType },
        byOwnerRefKey: { ...input.snapshot.byOwnerRefKey },
      });
      events.push(...input.events.map((event) => ({ ...event })));
    },
    runs: () => runs.map(copyRun),
    assetValues: () => ({ ...assetValues }),
    snapshot: (localDate) => {
      const value = snapshots.get(localDate);
      return value === undefined
        ? undefined
        : {
            ...value,
            byType: { ...value.byType },
            byOwnerRefKey: { ...value.byOwnerRefKey },
          };
    },
    events: () => events.map((event) => ({ ...event })),
  };

  return createDailyAssetValuationApplication({
    targetReader,
    provider,
    store,
    clock,
  });
}

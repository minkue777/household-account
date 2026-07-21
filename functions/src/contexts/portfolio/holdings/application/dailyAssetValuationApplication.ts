import type {
  DailyAssetValuationChangedEvent,
  DailyValuationRunView,
} from "../domain/model/dailyAssetValuation";
import { buildDailyAssetSnapshotIntent } from "../domain/policies/dailyAssetSnapshotPolicy";
import { pageItems } from "../../../../platform/pagination/public";
import type { DailyAssetValuation } from "./ports/in/dailyAssetValuation";
import type {
  DailyAssetValuationClock,
  DailyAssetValuationStore,
  DailyValuationProvider,
  DailyValuationTargetReader,
} from "./ports/out/dailyAssetValuationPorts";

const PAGE_SIZE = 50;
const PROVIDER_CONCURRENCY = 5;
const PAGE_ENTRY_DEDUPLICATION_MILLISECONDS = 30_000;

export function createDailyAssetValuationApplication(dependencies: {
  targetReader: DailyValuationTargetReader;
  provider: DailyValuationProvider;
  store: DailyAssetValuationStore;
  clock: DailyAssetValuationClock;
}): DailyAssetValuation {
  return {
    async run(command) {
      if (command.idempotencyKey !== undefined) {
        const replay = dependencies.store.findByIdempotencyKey(
          command.idempotencyKey,
        );
        if (replay !== undefined) return replay;
      }
      if (command.trigger === "asset-page-entry" && command.householdId !== undefined) {
        const recent = dependencies.store.findRecentPageRun({
          householdId: command.householdId,
          requestedAt: command.requestedAt,
          withinMilliseconds: PAGE_ENTRY_DEDUPLICATION_MILLISECONDS,
        });
        if (recent !== undefined) return recent;
      }

      const targets = await dependencies.targetReader.listAll(command.householdId);
      const succeeded: string[] = [];
      const retryableFailed: {
        targetId: string;
        code: string;
        retainedValueInWon: number;
      }[] = [];
      const valuesByTargetId: Record<string, number> = {};
      const assetValues: Record<string, number> = {};
      const events: DailyAssetValuationChangedEvent[] = [];
      let maxObservedProviderConcurrency = 0;

      for (const page of pageItems(targets, PAGE_SIZE)) {
        for (const batch of pageItems(page, PROVIDER_CONCURRENCY)) {
          maxObservedProviderConcurrency = Math.max(
            maxObservedProviderConcurrency,
            batch.length,
          );
          const results = await Promise.all(
            batch.map(async (target) => ({
              target,
              result: await dependencies.provider.value(target),
            })),
          );
          for (const { target, result } of results) {
            const value =
              result.kind === "success"
                ? result.valueInWon
                : target.previousSuccessfulValue;
            valuesByTargetId[target.targetId] = value;
            assetValues[target.assetId] = (assetValues[target.assetId] ?? 0) + value;
            if (result.kind === "success") {
              succeeded.push(target.targetId);
              events.push({
                eventType: "AssetValuationChanged.v1",
                assetId: target.assetId,
                currentSignedBalance: result.valueInWon,
              });
            } else {
              retryableFailed.push({
                targetId: target.targetId,
                code: result.code,
                retainedValueInWon: target.previousSuccessfulValue,
              });
            }
          }
        }
      }

      const createdAt = dependencies.clock.now();
      const run: DailyValuationRunView = {
        kind: retryableFailed.length === 0 ? "complete" : "partial-failure",
        runId:
          command.idempotencyKey ??
          `asset-page:${command.householdId ?? "unknown"}:${command.requestedAt}`,
        createdAt,
        completed: true,
        pageReceipts: pageItems(targets, PAGE_SIZE).map((page, index) => ({
          pageNumber: index + 1,
          targetIds: page.map(({ targetId }) => targetId),
          terminal: true,
        })),
        succeeded,
        retryableFailed,
        maxObservedProviderConcurrency,
        snapshotProjectionStatus: "queued",
      };
      const snapshot = buildDailyAssetSnapshotIntent({
        localDate: command.asOfDate,
        createdAt,
        targets,
        valuesByTargetId,
        previousScopes: dependencies.targetReader.previousSnapshotScopes(),
      });
      dependencies.store.commit({
        run,
        idempotencyKey: command.idempotencyKey,
        pageEntry:
          command.trigger === "asset-page-entry" && command.householdId !== undefined
            ? { householdId: command.householdId, requestedAt: command.requestedAt }
            : undefined,
        assetValues,
        snapshot,
        events,
      });
      return run;
    },
    listRuns: () => dependencies.store.runs(),
    currentAssetValues: () => dependencies.store.assetValues(),
    snapshotIntent: (localDate) => dependencies.store.snapshot(localDate),
    recordedEvents: () => dependencies.store.events(),
  };
}

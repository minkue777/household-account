import type {
  ScopedValuationRunResult,
  ScopedValuationTarget,
} from "../domain/model/assetValuationTriggerScope";
import {
  selectDailyValuationTargets,
  selectHouseholdValuationTargets,
} from "../domain/policies/assetValuationScopePolicy";
import { pageItems } from "../../../../platform/pagination/public";
import type { AssetValuationTriggerScope } from "./ports/in/assetValuationTriggerScope";
import type {
  ScopedValuationRunStore,
  ScopedValuationSource,
  ValuationRunInterrupter,
} from "./ports/out/assetValuationTriggerScopePorts";

async function processPage(input: {
  runId: string;
  targets: readonly ScopedValuationTarget[];
  source: ScopedValuationSource;
  store: ScopedValuationRunStore;
}): Promise<{ processed: string[]; failures: { targetId: string; code: string }[] }> {
  const processed: string[] = [];
  const failures: { targetId: string; code: string }[] = [];
  for (const target of input.targets) {
    const childKey = `${input.runId}:${target.targetId}`;
    const existing = input.store.child(childKey);
    if (existing !== undefined) {
      processed.push(target.targetId);
      continue;
    }
    const outcome = await input.source.value(target);
    input.store.commitChild({
      childKey,
      runId: input.runId,
      householdId: target.householdId,
      assetId: target.assetId,
      outcome:
        outcome.kind === "success" ? "succeeded" : "retained-last-success",
      resultingValueInWon:
        outcome.kind === "success"
          ? outcome.valueInWon
          : target.previousValueInWon,
    });
    processed.push(target.targetId);
    if (outcome.kind === "retryable-failure") {
      failures.push({ targetId: target.targetId, code: outcome.code });
    }
  }
  return { processed, failures };
}

export function createAssetValuationTriggerScopeApplication(dependencies: {
  source: ScopedValuationSource;
  store: ScopedValuationRunStore;
  interrupter: ValuationRunInterrupter;
  pageSize: number;
}): AssetValuationTriggerScope {
  async function execute(input: {
    runId: string;
    trigger: ScopedValuationRunResult["trigger"];
    householdIds: readonly string[];
    targets: readonly ScopedValuationTarget[];
    requestSnapshots: boolean;
    resumed?: boolean;
  }): Promise<ScopedValuationRunResult> {
    const previous = input.resumed ? dependencies.store.run(input.runId) : undefined;
    if (!input.resumed && previous !== undefined && previous.kind !== "interrupted") {
      return previous;
    }
    const pages = pageItems(input.targets, dependencies.pageSize);
    const pageReceipts = previous?.pageReceipts.map((page) => ({
      ...page,
      targetIds: [...page.targetIds],
    })) ?? [];
    const processedTargetIds = [...(previous?.processedTargetIds ?? [])];
    const retryableFailures = [...(previous?.retryableFailures ?? [])];
    const startPage = pageReceipts.length;

    for (let index = startPage; index < pages.length; index += 1) {
      const pageNumber = index + 1;
      const page = pages[index];
      const processed = await processPage({
        runId: input.runId,
        targets: page,
        source: dependencies.source,
        store: dependencies.store,
      });
      processedTargetIds.push(...processed.processed);
      retryableFailures.push(...processed.failures);
      const checkpointAfter = `${input.runId}:page:${pageNumber}`;
      pageReceipts.push({
        pageNumber,
        targetIds: page.map(({ targetId }) => targetId),
        terminal: true,
        checkpointAfter,
      });

      if (
        index < pages.length - 1 &&
        dependencies.interrupter.shouldInterrupt({
          runId: input.runId,
          pageNumber,
          resumed: input.resumed ?? false,
        })
      ) {
        const interrupted: ScopedValuationRunResult = {
          kind: "interrupted",
          runId: input.runId,
          trigger: input.trigger,
          householdIds: input.householdIds,
          processedTargetIds,
          pageReceipts,
          retryableFailures,
          snapshotRequestedForHouseholdIds: [],
          checkpoint: checkpointAfter,
        };
        dependencies.store.saveRun(interrupted);
        return interrupted;
      }
    }

    const completed: ScopedValuationRunResult = {
      kind: retryableFailures.length === 0 ? "complete" : "partial-failure",
      runId: input.runId,
      trigger: input.trigger,
      householdIds: input.householdIds,
      processedTargetIds,
      pageReceipts,
      retryableFailures,
      snapshotRequestedForHouseholdIds: input.requestSnapshots
        ? input.householdIds
        : [],
    };
    dependencies.store.saveRun(completed);
    return completed;
  }

  return {
    async refreshSingleAsset(input) {
      const householdTargets = selectHouseholdValuationTargets({
        householdId: input.actorHouseholdId,
        households: dependencies.source.households(),
        targets: dependencies.source.targets(),
      });
      return execute({
        runId: input.idempotencyKey,
        trigger: "manual-asset",
        householdIds: [input.actorHouseholdId],
        targets: householdTargets.filter(({ assetId }) => assetId === input.assetId),
        requestSnapshots: false,
      });
    },
    async refreshHouseholdOnPageEntry(input) {
      return execute({
        runId: `asset-page:${input.actorHouseholdId}:${input.requestedAt}`,
        trigger: "asset-page-entry",
        householdIds: [input.actorHouseholdId],
        targets: selectHouseholdValuationTargets({
          householdId: input.actorHouseholdId,
          households: dependencies.source.households(),
          targets: dependencies.source.targets(),
        }),
        requestSnapshots: false,
      });
    },
    async runDailyValuation(input) {
      const activeHouseholds = dependencies.source
        .households()
        .filter(({ lifecycle }) => lifecycle === "active")
        .map(({ householdId }) => householdId);
      return execute({
        runId: input.occurrenceId,
        trigger: "daily-23:55",
        householdIds: activeHouseholds,
        targets: selectDailyValuationTargets({
          households: dependencies.source.households(),
          targets: dependencies.source.targets(),
        }),
        requestSnapshots: true,
        resumed: input.resumeFromCheckpoint !== undefined,
      });
    },
    currentAssetValues: () => dependencies.store.values(),
    childReceipts: () => dependencies.store.children(),
    listRuns: () => dependencies.store.runs(),
  };
}

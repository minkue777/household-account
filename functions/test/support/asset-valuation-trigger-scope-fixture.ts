import { createAssetValuationTriggerScopeApplication } from "../../src/contexts/portfolio/holdings/application/assetValuationTriggerScopeApplication";
import type {
  ScopedValuationRunStore,
  ScopedValuationSource,
  ValuationRunInterrupter,
} from "../../src/contexts/portfolio/holdings/application/ports/out/assetValuationTriggerScopePorts";
import type {
  ScopedProviderResult,
  ScopedValuationRunResult,
  ScopedValuationTarget,
  ValuationChildReceipt,
  ValuationHousehold,
} from "../../src/contexts/portfolio/holdings/public";

interface SeedTarget extends ScopedValuationTarget {
  providerResult: ScopedProviderResult;
}

function copyRun(run: ScopedValuationRunResult): ScopedValuationRunResult {
  return {
    ...run,
    householdIds: [...run.householdIds],
    processedTargetIds: [...run.processedTargetIds],
    pageReceipts: run.pageReceipts.map((page) => ({
      ...page,
      targetIds: [...page.targetIds],
    })),
    retryableFailures: run.retryableFailures.map((failure) => ({ ...failure })),
    snapshotRequestedForHouseholdIds: [
      ...run.snapshotRequestedForHouseholdIds,
    ],
  };
}

export function createAssetValuationTriggerScopeFixture(fixture: {
  households: readonly ValuationHousehold[];
  targets: readonly SeedTarget[];
  pageSize?: number;
  interruptAfterPage?: number;
}) {
  const targets = fixture.targets.map(({ providerResult: _result, ...target }) => ({
    ...target,
  }));
  const outcomes = new Map(
    fixture.targets.map(({ targetId, providerResult }) => [targetId, providerResult]),
  );
  const storedRuns = new Map<string, ScopedValuationRunResult>();
  const children = new Map<string, ValuationChildReceipt>();
  const values: Record<string, number> = {};
  const interrupted = new Set<string>();

  const source: ScopedValuationSource = {
    households: () => fixture.households.map((household) => ({ ...household })),
    targets: () => targets.map((target) => ({ ...target })),
    value: async (target) =>
      outcomes.get(target.targetId) ?? {
        kind: "retryable-failure",
        code: "VALUATION_RESULT_MISSING",
      },
  };
  const store: ScopedValuationRunStore = {
    run: (runId) => {
      const run = storedRuns.get(runId);
      return run === undefined ? undefined : copyRun(run);
    },
    saveRun: (run) => storedRuns.set(run.runId, copyRun(run)),
    child: (childKey) => {
      const child = children.get(childKey);
      return child === undefined ? undefined : { ...child };
    },
    commitChild: (receipt) => {
      if (children.has(receipt.childKey)) return;
      children.set(receipt.childKey, { ...receipt });
      values[receipt.assetId] = receipt.resultingValueInWon;
    },
    values: () => ({ ...values }),
    children: () => [...children.values()].map((child) => ({ ...child })),
    runs: () => [...storedRuns.values()].map(copyRun),
  };
  const interrupter: ValuationRunInterrupter = {
    shouldInterrupt: ({ runId, pageNumber, resumed }) => {
      if (
        resumed ||
        fixture.interruptAfterPage !== pageNumber ||
        interrupted.has(runId)
      ) {
        return false;
      }
      interrupted.add(runId);
      return true;
    },
  };
  return createAssetValuationTriggerScopeApplication({
    source,
    store,
    interrupter,
    pageSize: fixture.pageSize ?? 50,
  });
}

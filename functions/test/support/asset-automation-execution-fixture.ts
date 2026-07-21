import { createAssetAutomationExecutionApplication } from "../../src/contexts/portfolio/automation/application/assetAutomationExecutionApplication";
import type {
  AssetAutomationExecutionStore,
  AutomationApplyDecision,
  AutomationExecutionOutcomeSource,
} from "../../src/contexts/portfolio/automation/application/ports/out/assetAutomationExecutionPorts";
import type { AutomationExecutionState } from "../../src/contexts/portfolio/automation/domain/model/assetAutomationExecution";
import type {
  AssetAutomationAppliedEvent,
  AutomatedAssetView,
  AutomationPlanView,
  AutomationRunResult,
} from "../../src/contexts/portfolio/automation/public";

export function createAssetAutomationExecutionFixture(fixture: {
  assets: readonly AutomatedAssetView[];
  plans: readonly AutomationPlanView[];
  outcomesByOccurrence?: Readonly<
    Record<string, Readonly<Record<string, "success" | "retryable-failure">>>
  >;
  pageSize?: number;
  transactionMayRetryCallback?: boolean;
}) {
  let state: AutomationExecutionState = {
    assets: structuredClone(fixture.assets),
    plans: structuredClone(fixture.plans),
    executions: [],
    receipts: [],
  };
  const occurrenceReceipts = new Map<string, AutomationRunResult>();
  const events: AssetAutomationAppliedEvent[] = [];
  let queue: Promise<void> = Promise.resolve();
  const store: AssetAutomationExecutionStore = {
    state: () => structuredClone(state),
    apply: (decide) => {
      let resolveResult!: (result: "applied" | "already-processed") => void;
      const result = new Promise<"applied" | "already-processed">((resolve) => {
        resolveResult = resolve;
      });
      queue = queue.then(() => {
        const snapshot = structuredClone(state);
        if (fixture.transactionMayRetryCallback) decide(structuredClone(snapshot));
        const decision: AutomationApplyDecision = decide(structuredClone(snapshot));
        if (decision.kind === "already-processed") {
          resolveResult("already-processed");
          return;
        }
        state = structuredClone(decision.state);
        events.push({ ...decision.event });
        resolveResult("applied");
      });
      return result;
    },
    markPlanNeedsAttention: (planId, code) => {
      state = {
        ...state,
        plans: state.plans.map((plan) =>
          plan.planId === planId
            ? { ...plan, status: "needs-attention", attentionCode: code }
            : plan,
        ),
      };
    },
    occurrenceReceipt: (occurrenceId) => {
      const receipt = occurrenceReceipts.get(occurrenceId);
      return receipt === undefined ? undefined : structuredClone(receipt);
    },
    saveOccurrenceReceipt: (occurrenceId, result) =>
      occurrenceReceipts.set(occurrenceId, structuredClone(result)),
    events: () => events.map((event) => ({ ...event })),
  };
  const outcomes: AutomationExecutionOutcomeSource = {
    outcome: ({ occurrenceId, executionKey }) =>
      fixture.outcomesByOccurrence?.[occurrenceId]?.[executionKey] ?? "success",
  };
  return createAssetAutomationExecutionApplication({
    store,
    outcomes,
    pageSize: fixture.pageSize ?? 50,
  });
}

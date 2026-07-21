import { pageItems } from "../../../../platform/pagination/public";
import type {
  AutomationExecutionState,
  AutomationExecutionView,
  AutomationPlanView,
  AutomationRunResult,
} from "../domain/model/assetAutomationExecution";
import {
  buildAutomationDueTasks,
  type AutomationDueTask,
} from "../domain/policies/automationDueTasks";
import { calculateEffectivePaymentDatePolicy } from "../domain/policies/effectivePaymentDate";
import { nextYearMonth, parseYearMonth } from "../domain/value-objects/yearMonth";
import type { AssetAutomationExecution } from "./ports/in/assetAutomationExecution";
import type {
  AssetAutomationExecutionStore,
  AutomationExecutionOutcomeSource,
} from "./ports/out/assetAutomationExecutionPorts";

function nextDueDate(plan: AutomationPlanView, targetMonth: string): string {
  const parsed = parseYearMonth(targetMonth);
  if (parsed === undefined) throw new Error("잘못된 자동화 대상 월입니다.");
  const month = nextYearMonth(parsed);
  const revision = [...plan.revisions]
    .filter(({ effectiveFromMonth }) => effectiveFromMonth <= month)
    .sort(
      (left, right) =>
        right.effectiveFromMonth.localeCompare(left.effectiveFromMonth) ||
        right.revision - left.revision,
    )[0];
  if (revision === undefined) throw new Error("다음 자동화 revision이 없습니다.");
  const date = calculateEffectivePaymentDatePolicy(month, revision.configuredDay);
  if (date.kind !== "success") throw new Error(date.code);
  return date.effectiveDate;
}

function applyTaskState(input: {
  state: AutomationExecutionState;
  task: AutomationDueTask;
  occurrenceId: string;
}): {
  state: AutomationExecutionState;
  execution: AutomationExecutionView;
} {
  const asset = input.state.assets.find(
    ({ assetId }) => assetId === input.task.asset.assetId,
  );
  const plan = input.state.plans.find(
    ({ planId }) => planId === input.task.plan.planId,
  );
  if (asset === undefined || plan === undefined) {
    throw new Error("자동화 대상 Asset 또는 Plan이 없습니다.");
  }
  const resultingBalanceInWon =
    asset.currentBalanceInWon + input.task.balanceDeltaInWon;
  const nextAsset = {
    ...asset,
    currentBalanceInWon: resultingBalanceInWon,
    aggregateVersion: asset.aggregateVersion + 1,
  };
  const nextPlan = {
    ...plan,
    nextDueDate: nextDueDate(plan, input.task.targetMonth),
  };
  const execution: AutomationExecutionView = {
    executionId: `automation-execution:${input.task.executionKey}`,
    executionKey: input.task.executionKey,
    occurrenceId: input.occurrenceId,
    planId: plan.planId,
    assetId: asset.assetId,
    targetMonth: input.task.targetMonth,
    effectiveDate: input.task.effectiveDate,
    appliedRevision: input.task.revision.revision,
    balanceDeltaInWon: input.task.balanceDeltaInWon,
    resultingBalanceInWon,
    status: "applied",
  };
  return {
    state: {
      assets: input.state.assets.map((value) =>
        value.assetId === nextAsset.assetId ? nextAsset : value,
      ),
      plans: input.state.plans.map((value) =>
        value.planId === nextPlan.planId ? nextPlan : value,
      ),
      executions: [...input.state.executions, execution],
      receipts: input.state.receipts,
    },
    execution,
  };
}

export function createAssetAutomationExecutionApplication(dependencies: {
  store: AssetAutomationExecutionStore;
  outcomes: AutomationExecutionOutcomeSource;
  pageSize: number;
}): AssetAutomationExecution {
  return {
    async runOccurrence(input) {
      const replay = dependencies.store.occurrenceReceipt(input.occurrenceId);
      if (replay !== undefined) return replay;
      const initial = dependencies.store.state();
      const invalidPlanIds: string[] = [];
      const tasks: AutomationDueTask[] = [];
      for (const plan of initial.plans) {
        const asset = initial.assets.find(({ assetId }) => assetId === plan.assetId);
        if (
          asset === undefined ||
          plan.status !== "active" ||
          asset.lifecycle !== "active"
        ) {
          continue;
        }
        const due = buildAutomationDueTasks({
          plan,
          asset,
          asOfDate: input.asOfDate,
        });
        if (due.kind === "invalid") {
          invalidPlanIds.push(plan.planId);
          dependencies.store.markPlanNeedsAttention(plan.planId, due.code);
          continue;
        }
        tasks.push(...due.tasks);
      }
      tasks.sort(
        (left, right) =>
          left.targetMonth.localeCompare(right.targetMonth) ||
          left.plan.planId.localeCompare(right.plan.planId),
      );

      const appliedExecutionKeys: string[] = [];
      const retryableFailures: { executionKey: string; code: string }[] = [];
      const blockedPlans = new Set<string>();
      const pages = pageItems(tasks, dependencies.pageSize);
      const pageResults = [];
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
        const page = pages[pageIndex];
        for (const task of page) {
          if (blockedPlans.has(task.plan.planId)) continue;
          if (
            dependencies.outcomes.outcome({
              occurrenceId: input.occurrenceId,
              executionKey: task.executionKey,
            }) === "retryable-failure"
          ) {
            retryableFailures.push({
              executionKey: task.executionKey,
              code: "AUTOMATION_APPLY_RETRYABLE",
            });
            blockedPlans.add(task.plan.planId);
            continue;
          }
          const applied = await dependencies.store.apply((state) => {
            if (
              state.executions.some(
                ({ executionKey }) => executionKey === task.executionKey,
              )
            ) {
              return { kind: "already-processed" };
            }
            const mutation = applyTaskState({
              state,
              task,
              occurrenceId: input.occurrenceId,
            });
            const asset = mutation.state.assets.find(
              ({ assetId }) => assetId === task.asset.assetId,
            )!;
            const receipt = {
              receiptId: `${input.occurrenceId}:${task.executionKey}`,
              occurrenceId: input.occurrenceId,
              executionKey: task.executionKey,
              resultingAssetVersion: asset.aggregateVersion,
            };
            return {
              kind: "commit",
              state: {
                ...mutation.state,
                receipts: [...mutation.state.receipts, receipt],
              },
              execution: mutation.execution,
              receipt,
              event: {
                eventType: "AssetAutomationApplied.v1",
                executionId: mutation.execution.executionId,
                executionKey: task.executionKey,
                assetId: task.asset.assetId,
                targetMonth: task.targetMonth,
                balanceDeltaInWon: task.balanceDeltaInWon,
                aggregateVersion: asset.aggregateVersion,
              },
            };
          });
          if (applied === "applied") appliedExecutionKeys.push(task.executionKey);
        }
        pageResults.push({
          pageNumber: pageIndex + 1,
          planIds: page.map(({ plan }) => plan.planId),
          checkpointAfter: `${input.occurrenceId}:page:${pageIndex + 1}`,
          terminal: true as const,
        });
      }
      const result: AutomationRunResult = {
        kind:
          retryableFailures.length === 0 && invalidPlanIds.length === 0
            ? "complete"
            : "partial-failure",
        occurrenceId: input.occurrenceId,
        pageResults,
        appliedExecutionKeys,
        retryableFailures,
        invalidPlanIds,
        ...(pageResults.length === 0
          ? {}
          : { checkpoint: pageResults[pageResults.length - 1].checkpointAfter }),
      };
      dependencies.store.saveOccurrenceReceipt(input.occurrenceId, result);
      return result;
    },
    inspectAsset: async (assetId) => {
      const asset = dependencies.store
        .state()
        .assets.find((candidate) => candidate.assetId === assetId);
      if (asset === undefined) throw new Error(`자산을 찾을 수 없습니다: ${assetId}`);
      return asset;
    },
    inspectPlan: async (planId) => {
      const plan = dependencies.store
        .state()
        .plans.find((candidate) => candidate.planId === planId);
      if (plan === undefined) throw new Error(`계획을 찾을 수 없습니다: ${planId}`);
      return plan;
    },
    listExecutions: async (planId) =>
      dependencies.store
        .state()
        .executions.filter((execution) => execution.planId === planId)
        .sort((left, right) => left.targetMonth.localeCompare(right.targetMonth)),
    receipts: () => dependencies.store.state().receipts,
    recordedEvents: () => dependencies.store.events(),
  };
}

import type { ProcessDueAssetAutomation } from "./ports/in/processDueAssetAutomation";
import type { AssetAutomationRuntimeStorePort } from "./ports/out/assetAutomationRuntimePorts";
import type { AssetAutomationTargetResult } from "../domain/model/assetAutomationRuntime";

function positivePageSize(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * Processes one ordered Plan at a time. A page can still contain many monthly
 * executions for that Plan, so a long outage converges oldest-month first while
 * the outer scheduler retains a small, durable cursor.
 */
export function createAssetAutomationScheduledApplication(dependencies: {
  readonly store: AssetAutomationRuntimeStorePort;
}): ProcessDueAssetAutomation {
  return {
    async processPage(input) {
      if (!positivePageSize(input.limit)) {
        throw new Error("INVALID_AUTOMATION_PAGE_SIZE");
      }
      const page = await dependencies.store.listDuePlans({
        asOfDate: input.asOfDate,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        // One Plan per outer page makes an updated nextDueDate visible again
        // after the cursor instead of accidentally skipping overdue months.
        limit: 1,
      });
      const plan = page.plans[0];
      if (plan === undefined) {
        return { completed: true, results: [] };
      }

      const results: AssetAutomationTargetResult[] = [];
      let nextDueDate = plan.nextDueDate;
      for (let index = 0; index < input.limit; index += 1) {
        const result = await dependencies.store.applyNextDue({
          plan: { ...plan, nextDueDate },
          asOfDate: input.asOfDate,
          occurrenceId: input.occurrenceId,
          processedAt: input.processedAt,
        });
        results.push(result);
        if (result.kind !== "applied" && result.kind !== "already-processed") {
          break;
        }
        nextDueDate = result.nextDueDate;
        if (nextDueDate > input.asOfDate) break;
      }

      return {
        completed: false,
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
        results,
      };
    },
  };
}

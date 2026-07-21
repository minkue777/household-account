import { createAssetAutomationScheduledApplication } from "../../src/contexts/portfolio/automation/public";
import type { AssetAutomationRuntimeStorePort } from "../../src/contexts/portfolio/automation/application/ports/out/assetAutomationRuntimePorts";
import { calculateEffectivePaymentDatePolicy } from "../../src/contexts/portfolio/automation/domain/policies/effectivePaymentDate";
import {
  nextYearMonth,
  parseYearMonth,
} from "../../src/contexts/portfolio/automation/domain/value-objects/yearMonth";

function followingDate(value: string): string {
  const nextMonth = nextYearMonth(parseYearMonth(value.slice(0, 7))!);
  const result = calculateEffectivePaymentDatePolicy(nextMonth, 18);
  if (result.kind !== "success") throw new Error(result.code);
  return result.effectiveDate;
}

export function createAssetAutomationScheduledRuntimeFixture(fixture: {
  readonly firstDueDate: string;
  readonly retryableFailureOn?: string;
}) {
  let nextDueDate = fixture.firstDueDate;
  const applied: string[] = [];
  const calls: string[] = [];
  const store: AssetAutomationRuntimeStorePort = {
    async listDuePlans(input) {
      return nextDueDate <= input.asOfDate
        ? {
            plans: [
              {
                householdId: "house-1",
                planId: "asset-1_savings-contribution",
                assetId: "asset-1",
                operation: "savings-contribution",
                nextDueDate,
                documentPath:
                  "households/house-1/assetAutomationPlans/asset-1_savings-contribution",
              },
            ],
            nextCursor: `after:${nextDueDate}`,
          }
        : { plans: [] };
    },
    async applyNextDue(input) {
      calls.push(input.plan.nextDueDate);
      if (fixture.retryableFailureOn === input.plan.nextDueDate) {
        return {
          kind: "retryable-failure",
          targetId: `plan-1:${input.plan.nextDueDate.slice(0, 7)}`,
          code: "AUTOMATION_UOW_COMMIT_FAILED",
        };
      }
      const targetMonth = nextDueDate.slice(0, 7);
      const executionKey = `house-1:asset-1:savings-contribution:${targetMonth}`;
      applied.push(executionKey);
      nextDueDate = followingDate(nextDueDate);
      return {
        kind: "applied",
        executionKey,
        executionId: `execution:${targetMonth}`,
        assetId: "asset-1",
        operation: "savings-contribution",
        targetMonth,
        nextDueDate,
      };
    },
  };
  const application = createAssetAutomationScheduledApplication({ store });
  return {
    processPage: application.processPage,
    appliedExecutionKeys: () => [...applied],
    applyCalls: () => [...calls],
  };
}

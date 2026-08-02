import type {
  BillingCostSourceReaderPort,
  BillingCostSummaryStorePort,
} from "../../platform/admin-operations/application/billingCostSummary";
import {
  BillingCostSourceNotReadyError,
  refreshBillingCost,
} from "../../platform/admin-operations/application/billingCostSummary";
import type { ScheduledFeaturePagePort } from "../../platform/external-operations/application/ports/out/scheduledJobExecutionPorts";

const COMPLETE_CHECKPOINT = "billing-cost:complete";

export function createBillingCostScheduledPages(input: {
  readonly projectId?: string;
  readonly calculatedAt: string;
  readonly source?: BillingCostSourceReaderPort;
  readonly store: BillingCostSummaryStorePort;
  readonly onFailure?: (error: unknown) => void;
}): ScheduledFeaturePagePort {
  return {
    async nextPage(checkpoint) {
      if (checkpoint === COMPLETE_CHECKPOINT) return undefined;
      if (checkpoint !== undefined) {
        throw new Error("BILLING_COST_CHECKPOINT_INVALID");
      }
      if (input.projectId === undefined || input.source === undefined) {
        return {
          checkpointAfter: COMPLETE_CHECKPOINT,
          terminal: true,
          targets: [{
            targetId: "billing-cost:current",
            outcome: {
              kind: "SKIPPED" as const,
              receipt: "billing-export-not-configured",
            },
          }],
        };
      }

      try {
        const summary = await refreshBillingCost({
          projectId: input.projectId,
          calculatedAt: input.calculatedAt,
          source: input.source,
          store: input.store,
        });
        return {
          checkpointAfter: COMPLETE_CHECKPOINT,
          terminal: true,
          targets: [{
            targetId: "billing-cost:current",
            outcome: {
              kind: "SUCCEEDED" as const,
              receipt: `${summary.billingMonth}:${summary.dataUpdatedAt}`,
            },
          }],
        };
      } catch (error) {
        if (error instanceof BillingCostSourceNotReadyError) {
          return {
            checkpointAfter: COMPLETE_CHECKPOINT,
            terminal: true,
            targets: [{
              targetId: "billing-cost:current",
              outcome: {
                kind: "SKIPPED" as const,
                receipt: "billing-export-data-not-ready",
              },
            }],
          };
        }
        input.onFailure?.(error);
        return {
          checkpointAfter: COMPLETE_CHECKPOINT,
          terminal: true,
          targets: [{
            targetId: "billing-cost:current",
            outcome: {
              kind: "FAILED" as const,
              code: "BILLING_COST_REFRESH_FAILED",
              retryable: false,
            },
          }],
        };
      }
    },
  };
}

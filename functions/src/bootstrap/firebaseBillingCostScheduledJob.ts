import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { FirebaseBillingCostSummaryStore } from "../adapters/firebase/admin/firebaseBillingCostSummaryStore";
import { createGoogleCloudBillingCostReader } from "../adapters/google-cloud/admin/googleCloudBillingCostReader";
import { db, REGION } from "../config";
import { createBillingCostScheduledPages } from "../operations/scheduling/billingCostScheduledPages";
import {
  scheduledFunctionTimeoutSeconds,
  scheduledJobDefinition,
} from "../operations/scheduling/scheduledJobDefinitions";
import { occurrenceFor } from "../operations/scheduling/scheduledOccurrence";
import { runTrackedScheduledJob } from "../operations/scheduling/trackedScheduledJob";

const definition = scheduledJobDefinition("billing-cost-refresh");

export const billingCostRefresh = onSchedule(
  {
    schedule: definition.cron,
    timeZone: "Asia/Seoul",
    region: REGION,
    timeoutSeconds: scheduledFunctionTimeoutSeconds(definition),
    memory: "256MiB",
    retryCount: 0,
  },
  async (event) => {
    const occurrence = occurrenceFor(
      "billing-cost-refresh",
      event.scheduleTime,
    );
    const configuration = createGoogleCloudBillingCostReader();
    const result = await runTrackedScheduledJob({
      database: db,
      request: {
        jobName: occurrence.jobName,
        scheduledFor: occurrence.scheduledFor,
        workerId: `${event.jobName ?? "billing-cost-refresh-scheduler"}:${event.context.eventId}`,
        pages: createBillingCostScheduledPages({
          projectId: configuration?.projectId,
          calculatedAt: occurrence.scheduledFor,
          source: configuration?.reader,
          store: new FirebaseBillingCostSummaryStore(db),
          onFailure(error) {
            logger.error("billing-cost-refresh-failed", {
              eventType: "BILLING_COST_REFRESH_FAILED",
              code: error instanceof Error ? error.message : "UNKNOWN",
              scheduledFor: occurrence.scheduledFor,
            });
          },
        }),
      },
    });
    if (result.status === "FAILED") {
      throw new Error("BILLING_COST_REFRESH_JOB_FAILED");
    }
  },
);

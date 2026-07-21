import { onSchedule } from "firebase-functions/v2/scheduler";

import { db, REGION } from "../config";
import { createAssetValuationScheduledPages } from "../operations/scheduling/assetValuationScheduledPages";
import {
  scheduledFunctionTimeoutSeconds,
  scheduledJobDefinition,
} from "../operations/scheduling/scheduledJobDefinitions";
import { occurrenceFor } from "../operations/scheduling/scheduledOccurrence";
import { runTrackedScheduledJob } from "../operations/scheduling/trackedScheduledJob";

const definition = scheduledJobDefinition("asset-valuation-daily");

function seoulDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export const assetValuationDaily = onSchedule(
  {
    schedule: definition.cron,
    timeZone: "Asia/Seoul",
    region: REGION,
    timeoutSeconds: scheduledFunctionTimeoutSeconds(definition),
    memory: "1GiB",
    retryCount: 2,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 300,
  },
  async (event) => {
    const occurrence = occurrenceFor(
      "asset-valuation-daily",
      event.scheduleTime,
    );
    const result = await runTrackedScheduledJob({
      database: db,
      request: {
        jobName: occurrence.jobName,
        scheduledFor: occurrence.scheduledFor,
        workerId: `${event.jobName ?? "asset-valuation-daily-scheduler"}:${event.context.eventId}`,
        pages: createAssetValuationScheduledPages({
          database: db,
          executionKey: occurrence.executionKey,
          scheduledFor: occurrence.scheduledFor,
          asOfDate: seoulDate(occurrence.scheduledFor),
        }),
      },
    });
    if (result.status === "FAILED") {
      throw new Error("ASSET_VALUATION_DAILY_JOB_FAILED");
    }
  },
);

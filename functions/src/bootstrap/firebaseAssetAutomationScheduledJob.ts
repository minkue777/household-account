import { onSchedule } from "firebase-functions/v2/scheduler";

import { db, REGION } from "../config";
import { createAssetAutomationScheduledPages } from "../operations/scheduling/assetAutomationScheduledPages";
import {
  scheduledFunctionTimeoutSeconds,
  scheduledJobDefinition,
} from "../operations/scheduling/scheduledJobDefinitions";
import { occurrenceFor } from "../operations/scheduling/scheduledOccurrence";
import { runTrackedScheduledJob } from "../operations/scheduling/trackedScheduledJob";

const definition = scheduledJobDefinition("asset-automation-daily");

function seoulDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export const assetAutomationDaily = onSchedule(
  {
    schedule: definition.cron,
    timeZone: "Asia/Seoul",
    region: REGION,
    timeoutSeconds: scheduledFunctionTimeoutSeconds(definition),
    retryCount: 2,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 300,
  },
  async (event) => {
    const occurrence = occurrenceFor(
      "asset-automation-daily",
      event.scheduleTime,
    );
    const result = await runTrackedScheduledJob({
      database: db,
      request: {
        jobName: occurrence.jobName,
        scheduledFor: occurrence.scheduledFor,
        workerId: `${event.jobName ?? "asset-automation-daily-scheduler"}:${event.context.eventId}`,
        pages: createAssetAutomationScheduledPages({
          database: db,
          occurrenceId: occurrence.executionKey,
          asOfDate: seoulDate(occurrence.scheduledFor),
          processedAt: occurrence.scheduledFor,
          pageSize: definition.pageSize,
        }),
      },
    });
    if (result.status === "FAILED") {
      throw new Error("ASSET_AUTOMATION_DAILY_JOB_FAILED");
    }
  },
);

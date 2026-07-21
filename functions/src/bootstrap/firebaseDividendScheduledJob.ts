import { onSchedule } from "firebase-functions/v2/scheduler";

import { db, REGION } from "../config";
import { createDividendScheduledPages } from "../operations/scheduling/dividendScheduledPages";
import {
  scheduledFunctionTimeoutSeconds,
  scheduledJobDefinition,
} from "../operations/scheduling/scheduledJobDefinitions";
import { occurrenceFor } from "../operations/scheduling/scheduledOccurrence";
import { runTrackedScheduledJob } from "../operations/scheduling/trackedScheduledJob";

const definition = scheduledJobDefinition("dividend-hourly");

function seoulDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function oneYearBefore(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const targetYear = year - 1;
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  return `${String(targetYear).padStart(4, "0")}-${String(month).padStart(
    2,
    "0",
  )}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

export const dividendHourly = onSchedule(
  {
    schedule: definition.cron,
    timeZone: "Asia/Seoul",
    region: REGION,
    // Keep a persistence buffer inside the SDK's 540-second event-function limit.
    timeoutSeconds: scheduledFunctionTimeoutSeconds(definition),
    memory: "1GiB",
    retryCount: 2,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 300,
  },
  async (event) => {
    const occurrence = occurrenceFor("dividend-hourly", event.scheduleTime);
    const asOfDate = seoulDate(occurrence.scheduledFor);
    const result = await runTrackedScheduledJob({
      database: db,
      request: {
        jobName: occurrence.jobName,
        scheduledFor: occurrence.scheduledFor,
        workerId: `${event.jobName ?? "dividend-hourly-scheduler"}:${event.context.eventId}`,
        pages: createDividendScheduledPages({
          database: db,
          executionKey: occurrence.executionKey,
          asOfDate,
          periodFrom: oneYearBefore(asOfDate),
          periodTo: asOfDate,
          observedAt: occurrence.scheduledFor,
          pageSize: definition.pageSize,
        }),
      },
    });
    if (result.status === "FAILED") {
      throw new Error("DIVIDEND_HOURLY_JOB_FAILED");
    }
  },
);

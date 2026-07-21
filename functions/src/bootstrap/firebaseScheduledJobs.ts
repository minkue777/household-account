import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";

import { db, REGION } from "../config";
import {
  scheduledFunctionTimeoutSeconds,
  scheduledJobDefinition,
} from "../operations/scheduling/scheduledJobDefinitions";
import { runScheduledJobMonitor } from "../operations/scheduling/scheduledJobMonitorRuntime";
import { createInstrumentCatalogScheduledPages } from "../operations/scheduling/instrumentCatalogScheduledPages";
import { occurrenceFor } from "../operations/scheduling/scheduledOccurrence";
import { runTrackedScheduledJob } from "../operations/scheduling/trackedScheduledJob";
import { createRecurringScheduledPages } from "../operations/scheduling/recurringScheduledPages";

const monitorDefinition = scheduledJobDefinition("scheduled-job-monitor");
const catalogDefinition = scheduledJobDefinition("instrument-catalog-daily");
const recurringDefinition = scheduledJobDefinition("recurring-daily");

function seoulDate(scheduledFor: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(scheduledFor));
}

export const instrumentCatalogDaily = onSchedule(
  {
    schedule: catalogDefinition.cron,
    timeZone: "Asia/Seoul",
    region: REGION,
    timeoutSeconds: scheduledFunctionTimeoutSeconds(catalogDefinition),
    memory: "1GiB",
    retryCount: 2,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 300,
  },
  async (event) => {
    const occurrence = occurrenceFor(
      "instrument-catalog-daily",
      event.scheduleTime,
    );
    const result = await runTrackedScheduledJob({
      database: db,
      request: {
        jobName: occurrence.jobName,
        scheduledFor: occurrence.scheduledFor,
        workerId: `${event.jobName ?? "instrument-catalog-scheduler"}:${event.context.eventId}`,
        pages: createInstrumentCatalogScheduledPages({
          database: db,
          asOfDate: seoulDate(occurrence.scheduledFor),
          runId: occurrence.executionKey,
        }),
      },
    });
    if (result.status === "FAILED") {
      throw new Error("INSTRUMENT_CATALOG_JOB_FAILED");
    }
  },
);

export const recurringDaily = onSchedule(
  {
    schedule: recurringDefinition.cron,
    timeZone: "Asia/Seoul",
    region: REGION,
    timeoutSeconds: scheduledFunctionTimeoutSeconds(recurringDefinition),
    retryCount: 2,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 300,
  },
  async (event) => {
    const occurrence = occurrenceFor("recurring-daily", event.scheduleTime);
    const result = await runTrackedScheduledJob({
      database: db,
      request: {
        jobName: occurrence.jobName,
        scheduledFor: occurrence.scheduledFor,
        workerId: `${event.jobName ?? "recurring-daily-scheduler"}:${event.context.eventId}`,
        pages: createRecurringScheduledPages({
          database: db,
          asOfDate: seoulDate(occurrence.scheduledFor),
          processedAt: occurrence.scheduledFor,
          pageSize: recurringDefinition.pageSize,
        }),
      },
    });
    if (result.status === "FAILED") {
      throw new Error("RECURRING_DAILY_JOB_FAILED");
    }
  },
);

export const scheduledJobMonitor = onSchedule(
  {
    schedule: monitorDefinition.cron,
    timeZone: "Asia/Seoul",
    region: REGION,
    timeoutSeconds: scheduledFunctionTimeoutSeconds(monitorDefinition),
    retryCount: 2,
    minBackoffSeconds: 30,
    maxBackoffSeconds: 120,
  },
  async (event) => {
    const result = await runScheduledJobMonitor({
      database: db,
      scheduledFor: event.scheduleTime,
    });
    logger.info("scheduled-job-monitor-heartbeat", {
      eventType: "SCHEDULED_JOB_MONITOR_HEARTBEAT",
      scheduledFor: event.scheduleTime,
      inspectedCount: result.inspectedOccurrenceIds.length,
      openedCount: result.openedIncidentIds.length,
      resolvedCount: result.resolvedIncidentIds.length,
    });
  },
);

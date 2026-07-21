import type {
  ScheduledJobDefinition,
  ScheduledJobDefinitionSet,
  ScheduledJobName,
} from "./scheduledJobDefinitions";

const SEOUL_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1_000;

export interface ScheduledOccurrence {
  readonly jobName: ScheduledJobName;
  readonly scheduledFor: string;
  readonly executionKey: string;
}

interface SeoulParts {
  readonly date: string;
  readonly hour: number;
  readonly minute: number;
}

function assertInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("SCHEDULE_TIME_INVALID");
  return parsed;
}

function seoulParts(instant: string): SeoulParts {
  const shifted = new Date(assertInstant(instant) + SEOUL_OFFSET_MILLISECONDS);
  return {
    date: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function seoulInstant(date: string, hour: number, minute: number): string {
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) throw new Error("LOCAL_DATE_INVALID");
  return new Date(
    parsed + hour * 60 * 60 * 1_000 + minute * 60 * 1_000 - SEOUL_OFFSET_MILLISECONDS,
  ).toISOString();
}

function localDateOffset(date: string, days: number): string {
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) throw new Error("LOCAL_DATE_INVALID");
  return new Date(parsed + days * 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
}

export function executionKeyFor(
  jobName: ScheduledJobName,
  scheduledFor: string,
): string {
  const local = seoulParts(scheduledFor);
  switch (jobName) {
    case "recurring-daily":
      return `recurring-daily:${local.date}`;
    case "asset-automation-daily":
      return `asset-automation-daily:${local.date}`;
    case "instrument-catalog-daily":
      return `instrument-catalog:${local.date}:1`;
    case "dividend-hourly":
      return `dividend-hourly:${local.date}T${String(local.hour).padStart(2, "0")}`;
    case "asset-valuation-daily":
      return `asset-valuation-daily:${local.date}`;
    case "scheduled-job-monitor":
      return `scheduled-job-monitor:${local.date}T${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
  }
}

export function occurrenceFor(
  jobName: ScheduledJobName,
  scheduledFor: string,
): ScheduledOccurrence {
  const normalized = new Date(assertInstant(scheduledFor)).toISOString();
  return {
    jobName,
    scheduledFor: normalized,
    executionKey: executionKeyFor(jobName, normalized),
  };
}

function fixedTime(definition: ScheduledJobDefinition): {
  readonly hour: number;
  readonly minute: number;
} {
  const fields = definition.cron.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("SCHEDULE_CRON_UNSUPPORTED");
  const minute = Number(fields[0]);
  const hour = Number(fields[1]);
  if (
    !Number.isSafeInteger(minute) ||
    !Number.isSafeInteger(hour) ||
    minute < 0 ||
    minute > 59 ||
    hour < 0 ||
    hour > 23
  ) {
    throw new Error("SCHEDULE_CRON_UNSUPPORTED");
  }
  return { hour, minute };
}

/**
 * Materializes business-job occurrences independently of their handlers. This is
 * what lets the monitor distinguish "the handler never ran" from "there was no
 * work to process". Korea has no DST, so the fixed +09:00 conversion is exact.
 */
export function expectedBusinessOccurrences(input: {
  readonly observedAt: string;
  readonly lookbackHours: number;
  readonly definitions: ScheduledJobDefinitionSet;
}): readonly ScheduledOccurrence[] {
  if (!Number.isFinite(input.lookbackHours) || input.lookbackHours <= 0) {
    throw new Error("LOOKBACK_HOURS_INVALID");
  }
  const observed = assertInstant(input.observedAt);
  const cutoff = observed - input.lookbackHours * 60 * 60 * 1_000;
  const localToday = seoulParts(input.observedAt).date;
  const candidates: ScheduledOccurrence[] = [];

  for (let dayOffset = -3; dayOffset <= 0; dayOffset += 1) {
    const date = localDateOffset(localToday, dayOffset);
    for (const definition of input.definitions.definitions) {
      if (definition.jobName === "scheduled-job-monitor") continue;
      if (definition.jobName === "dividend-hourly") {
        for (let hour = 9; hour <= 20; hour += 1) {
          const scheduledFor = seoulInstant(date, hour, 0);
          const instant = assertInstant(scheduledFor);
          if (instant >= cutoff && instant <= observed) {
            candidates.push(occurrenceFor(definition.jobName, scheduledFor));
          }
        }
        continue;
      }
      const { hour, minute } = fixedTime(definition);
      const scheduledFor = seoulInstant(date, hour, minute);
      const instant = assertInstant(scheduledFor);
      if (instant >= cutoff && instant <= observed) {
        candidates.push(occurrenceFor(definition.jobName, scheduledFor));
      }
    }
  }

  return candidates.sort((left, right) =>
    left.scheduledFor.localeCompare(right.scheduledFor) ||
    left.jobName.localeCompare(right.jobName),
  );
}

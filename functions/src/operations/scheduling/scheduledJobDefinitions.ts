import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const SCHEDULED_JOB_NAMES = [
  "recurring-daily",
  "asset-automation-daily",
  "instrument-catalog-daily",
  "dividend-hourly",
  "asset-valuation-daily",
  "scheduled-job-monitor",
] as const;

export type ScheduledJobName = (typeof SCHEDULED_JOB_NAMES)[number];

/**
 * firebase-functions 7.x는 onSchedule을 event function으로 검증하므로
 * 배포 가능한 최대 timeout은 540초입니다. 실제 업무 deadline 뒤에
 * 실행 결과를 기록할 시간을 남기기 위해 업무 예산은 480초로 제한합니다.
 */
export const MAX_SCHEDULED_EXECUTION_SECONDS = 480;
export const MAX_SCHEDULED_FUNCTION_TIMEOUT_SECONDS = 540;
export const SCHEDULED_PERSISTENCE_BUFFER_SECONDS = 30;

export interface ScheduledJobDefinition {
  readonly jobName: ScheduledJobName;
  readonly cron: string;
  readonly startGraceSeconds: number;
  readonly executionDeadlineSeconds: number;
  readonly heartbeatTimeoutSeconds: number;
  readonly leaseDurationSeconds: number;
  readonly pageSize: number;
  readonly maxPagesPerOccurrence: number;
}

export interface ScheduledJobDefinitionSet {
  readonly schemaVersion: 1;
  readonly timezone: "Asia/Seoul";
  readonly definitions: readonly ScheduledJobDefinition[];
}

function contractCandidates(): readonly string[] {
  return [
    resolve(
      __dirname,
      "../../contracts/operations/scheduled-job-definitions.v1.json",
    ),
    resolve(
      __dirname,
      "../../../../contracts/fixtures/operations/scheduled-job-definitions.v1.json",
    ),
  ];
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function parseDefinition(value: unknown): ScheduledJobDefinition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("SCHEDULED_JOB_DEFINITION_INVALID");
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.jobName !== "string" ||
    !SCHEDULED_JOB_NAMES.includes(input.jobName as ScheduledJobName) ||
    typeof input.cron !== "string" ||
    input.cron.trim() === "" ||
    !positiveInteger(input.startGraceSeconds) ||
    !positiveInteger(input.executionDeadlineSeconds) ||
    !positiveInteger(input.heartbeatTimeoutSeconds) ||
    !positiveInteger(input.leaseDurationSeconds) ||
    !positiveInteger(input.pageSize) ||
    !positiveInteger(input.maxPagesPerOccurrence)
  ) {
    throw new Error("SCHEDULED_JOB_DEFINITION_INVALID");
  }
  if (input.executionDeadlineSeconds > MAX_SCHEDULED_EXECUTION_SECONDS) {
    throw new Error("SCHEDULED_JOB_DEFINITION_INVALID");
  }
  if (
    input.heartbeatTimeoutSeconds > input.executionDeadlineSeconds ||
    input.leaseDurationSeconds < input.heartbeatTimeoutSeconds
  ) {
    throw new Error("SCHEDULED_JOB_DEFINITION_INVALID");
  }
  return input as unknown as ScheduledJobDefinition;
}

export function loadScheduledJobDefinitions(
  readText: (path: string) => string = (path) => readFileSync(path, "utf8"),
): ScheduledJobDefinitionSet {
  let raw: string | undefined;
  for (const candidate of contractCandidates()) {
    try {
      raw = readText(candidate);
      break;
    } catch {
      // The next path is the source-tree fallback used by tests and local tools.
    }
  }
  if (raw === undefined) throw new Error("SCHEDULED_JOB_DEFINITIONS_UNAVAILABLE");

  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (
    parsed.schemaVersion !== 1 ||
    parsed.timezone !== "Asia/Seoul" ||
    !Array.isArray(parsed.definitions)
  ) {
    throw new Error("SCHEDULED_JOB_DEFINITIONS_INVALID");
  }
  const definitions = parsed.definitions.map(parseDefinition);
  if (
    definitions.length !== SCHEDULED_JOB_NAMES.length ||
    new Set(definitions.map(({ jobName }) => jobName)).size !== definitions.length
  ) {
    throw new Error("SCHEDULED_JOB_DEFINITIONS_INVALID");
  }
  return { schemaVersion: 1, timezone: "Asia/Seoul", definitions };
}

export function scheduledJobDefinition(
  name: ScheduledJobName,
  definitions: ScheduledJobDefinitionSet = loadScheduledJobDefinitions(),
): ScheduledJobDefinition {
  const definition = definitions.definitions.find(({ jobName }) => jobName === name);
  if (definition === undefined) throw new Error(`SCHEDULED_JOB_DEFINITION_MISSING:${name}`);
  return definition;
}

export function scheduledFunctionTimeoutSeconds(
  definition: Pick<ScheduledJobDefinition, "executionDeadlineSeconds">,
): number {
  return Math.min(
    MAX_SCHEDULED_FUNCTION_TIMEOUT_SECONDS,
    definition.executionDeadlineSeconds + SCHEDULED_PERSISTENCE_BUFFER_SECONDS,
  );
}

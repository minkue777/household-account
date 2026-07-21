import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import {
  MAX_SCHEDULED_EXECUTION_SECONDS,
  loadScheduledJobDefinitions,
  scheduledFunctionTimeoutSeconds,
  scheduledJobDefinition,
} from "../../../src/operations/scheduling/scheduledJobDefinitions";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")) as T;
}

interface ScheduledDefinition {
  jobName: string;
  cron: string;
  startGraceSeconds: number;
  executionDeadlineSeconds: number;
  heartbeatTimeoutSeconds: number;
  leaseDurationSeconds: number;
  pageSize: number;
  maxPagesPerOccurrence: number;
}

describe("예약 작업 versioned 실행 정의", () => {
  const schema = readJson<Record<string, unknown>>(
    "contracts/schemas/operations/scheduled-job-definitions.v1.schema.json",
  );
  const fixture = readJson<{
    schemaVersion: number;
    timezone: string;
    definitions: ScheduledDefinition[];
  }>("contracts/fixtures/operations/scheduled-job-definitions.v1.json");
  const manifest = readJson<{ jobs: Array<{ jobName: string; cron: string }> }>(
    "contracts/fixtures/operations/scheduled-jobs.v1.json",
  );

  it("[T-JOB-001][JOB-ERR-002] 유한한 grace·deadline·heartbeat·lease·page 예산만 허용한다", () => {
    const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    for (const definition of fixture.definitions) {
      expect(definition.heartbeatTimeoutSeconds).toBeLessThanOrEqual(
        definition.executionDeadlineSeconds,
      );
      // Firebase 2세대 Scheduled/Task queue 함수의 현재 최대 실행 시간입니다.
      expect(definition.executionDeadlineSeconds).toBeLessThanOrEqual(
        MAX_SCHEDULED_EXECUTION_SECONDS,
      );
      expect(scheduledFunctionTimeoutSeconds(definition)).toBeLessThanOrEqual(540);
      expect(scheduledFunctionTimeoutSeconds(definition)).toBeGreaterThan(
        definition.executionDeadlineSeconds,
      );
      expect(definition.leaseDurationSeconds).toBeGreaterThanOrEqual(
        definition.heartbeatTimeoutSeconds,
      );
      expect(definition.pageSize * definition.maxPagesPerOccurrence).toBeGreaterThan(0);
    }
  });

  it("[T-JOB-001] 배포 cron manifest와 실행 정의가 정확히 일치한다", () => {
    const expected = manifest.jobs
      .map(({ jobName, cron }) => `${jobName}:${cron}`)
      .sort();
    const actual = fixture.definitions
      .map(({ jobName, cron }) => `${jobName}:${cron}`)
      .sort();

    expect(new Set(fixture.definitions.map(({ jobName }) => jobName)).size).toBe(
      fixture.definitions.length,
    );
    expect(actual).toEqual(expected);
  });

  it("[T-JOB-001] Functions composition은 같은 계약 artifact를 읽고 누락 정의에서 시작을 거부한다", () => {
    const loaded = loadScheduledJobDefinitions();

    expect(loaded).toEqual(fixture);
    expect(scheduledJobDefinition("dividend-hourly", loaded).cron).toBe(
      "0 9-20 * * *",
    );
  });
});

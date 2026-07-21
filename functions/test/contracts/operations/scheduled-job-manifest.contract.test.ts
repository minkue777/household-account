import Ajv, { type AnySchema } from "ajv";
import { describe, expect, it } from "vitest";

import { readContractJson } from "../../support/contract-json";

interface ScheduledJobDefinition {
  jobName: string;
  cron: string;
  publicInputPort: string;
  capability: string;
  idempotency: {
    executionKeyTemplate: string;
    targetKeyTemplate: string;
  };
  dependsOn: string[];
}

interface ScheduledJobManifestV1 {
  schemaVersion: 1;
  timezone: "Asia/Seoul";
  jobs: ScheduledJobDefinition[];
}

const schema = readContractJson<AnySchema>(
  "schemas/operations/scheduled-job-manifest.v1.schema.json",
);
const manifest = readContractJson<ScheduledJobManifestV1>(
  "fixtures/operations/scheduled-jobs.v1.json",
);

const expectedJobs = {
  "recurring-daily": {
    cron: "0 0 * * *",
    publicInputPort: "ProcessDueRecurringPlans",
    capability: "recurring.process",
    executionKeyTemplate: "recurring-daily:{asOfDate}",
    targetKeyTemplate: "planId:YYYY-MM",
  },
  "asset-automation-daily": {
    cron: "0 0 * * *",
    publicInputPort: "ProcessDueAssetAutomation",
    capability: "portfolio.job.asset-automation",
    executionKeyTemplate: "asset-automation-daily:{asOfDate}",
    targetKeyTemplate: "householdId:assetId:operation:YYYY-MM",
  },
  "instrument-catalog-daily": {
    cron: "0 6 * * *",
    publicInputPort: "PublishInstrumentCatalog",
    capability: "portfolio.job.instrument-catalog",
    executionKeyTemplate: "instrument-catalog:{asOfDate}:{schemaVersion}",
    targetKeyTemplate: "snapshotGeneration:checksum",
  },
  "dividend-hourly": {
    cron: "0 9-20 * * *",
    publicInputPort: "RefreshDividendEvents",
    capability: "portfolio.job.dividend-refresh",
    executionKeyTemplate: "dividend-hourly:{scheduledHour}",
    targetKeyTemplate: "phase:cursor:eventId",
  },
  "asset-valuation-daily": {
    cron: "55 23 * * *",
    publicInputPort: "RunDailyAssetValuation",
    capability: "portfolio.job.daily-valuation",
    executionKeyTemplate: "asset-valuation-daily:{asOfDate}",
    targetKeyTemplate: "runId:assetId:quoteBatchId",
  },
  "scheduled-job-monitor": {
    cron: "*/5 * * * *",
    publicInputPort: "DetectMissingOrOverdueRuns",
    capability: "operations.job.monitor",
    executionKeyTemplate: "scheduled-job-monitor:{scheduledMinute}",
    targetKeyTemplate: "jobName:scheduledFor",
  },
} as const;

describe("예약 작업 공개 계약 manifest v1", () => {
  it("[T-JOB-001] fixture가 versioned JSON Schema를 만족한다", () => {
    const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

    expect(
      validate(manifest),
      JSON.stringify(validate.errors, null, 2),
    ).toBe(true);
  });

  it("[T-JOB-001] Asia/Seoul의 확정된 6개 job과 공개 계약을 정확히 선언한다", () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.timezone).toBe("Asia/Seoul");
    expect(manifest.jobs).toHaveLength(6);

    const jobNames = manifest.jobs.map(({ jobName }) => jobName);
    expect(new Set(jobNames).size).toBe(jobNames.length);
    expect([...jobNames].sort()).toEqual(Object.keys(expectedJobs).sort());

    const scheduleBindings = manifest.jobs.map(
      ({ jobName, cron }) => `${jobName}@${cron}`,
    );
    expect(new Set(scheduleBindings).size).toBe(scheduleBindings.length);

    for (const job of manifest.jobs) {
      const expected = expectedJobs[job.jobName as keyof typeof expectedJobs];

      expect(expected).toBeDefined();
      expect(job).toMatchObject({
        cron: expected.cron,
        publicInputPort: expected.publicInputPort,
        capability: expected.capability,
        idempotency: {
          executionKeyTemplate: expected.executionKeyTemplate,
          targetKeyTemplate: expected.targetKeyTemplate,
        },
      });
    }
  });

  it("[T-DIV-003] 배당의 시간별 occurrence 실행 키에 scheduledHour를 포함한다", () => {
    const dividendJob = manifest.jobs.find(
      ({ jobName }) => jobName === "dividend-hourly",
    );

    expect(dividendJob?.cron).toBe("0 9-20 * * *");
    expect(dividendJob?.idempotency.executionKeyTemplate).toBe(
      "dividend-hourly:{scheduledHour}",
    );
    expect(dividendJob?.idempotency.executionKeyTemplate).toContain(
      "{scheduledHour}",
    );
  });

  it("[T-REC-005][AUTO-003] 두 00:00 job은 실행 의존성이 없는 별도 계약이다", () => {
    const midnightJobs = manifest.jobs.filter(
      ({ cron }) => cron === "0 0 * * *",
    );

    expect(midnightJobs.map(({ jobName }) => jobName).sort()).toEqual([
      "asset-automation-daily",
      "recurring-daily",
    ]);
    expect(midnightJobs.every(({ dependsOn }) => dependsOn.length === 0)).toBe(
      true,
    );
    expect(
      new Set(midnightJobs.map(({ publicInputPort }) => publicInputPort)).size,
    ).toBe(midnightJobs.length);
    expect(new Set(midnightJobs.map(({ capability }) => capability)).size).toBe(
      midnightJobs.length,
    );
    expect(
      new Set(
        midnightJobs.map(
          ({ idempotency }) => idempotency.executionKeyTemplate,
        ),
      ).size,
    ).toBe(midnightJobs.length);
  });
});

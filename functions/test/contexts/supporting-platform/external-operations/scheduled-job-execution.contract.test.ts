import { describe, expect, it } from "vitest";

import { createScheduledJobExecutionFixture } from "../../../support/scheduled-job-execution-fixture";

type JobStatus =
  | "RUNNING"
  | "COMPLETE"
  | "PARTIAL_FAILURE"
  | "FAILED"
  | "OVERDUE";

interface TargetFixture {
  targetId: string;
  outcome:
    | { kind: "SUCCEEDED"; receipt: string }
    | { kind: "SKIPPED"; receipt: string }
    | { kind: "FAILED"; code: string; retryable: boolean };
}

interface JobPageFixture {
  checkpointBefore?: string;
  checkpointAfter?: string;
  terminal?: boolean;
  targets: readonly TargetFixture[];
}

interface StoredTargetResult {
  targetIdHash: string;
  kind: "SUCCEEDED" | "SKIPPED" | "FAILED";
  receipt?: string;
  code?: string;
  retryable?: boolean;
}

interface LeaseView {
  ownerId: string;
  expiresAt: string;
  attempt: number;
  token: string;
}

interface JobRunView {
  runId: string;
  jobName: string;
  executionKey: string;
  status: JobStatus;
  checkpoint?: string;
  lease?: LeaseView;
  lastHeartbeatAt?: string;
  targets: readonly StoredTargetResult[];
  totals: {
    target: number;
    succeeded: number;
    skipped: number;
    failed: number;
  };
}

interface JobExecutionResult {
  runId: string;
  jobName: string;
  status: "COMPLETE" | "PARTIAL_FAILURE" | "FAILED";
  checkpoint?: string;
  totals: JobRunView["totals"];
  failures: readonly (
    | {
        scope: "target";
        targetIdHash: string;
        code: string;
        retryable: boolean;
      }
    | { scope: "job"; code: string; retryable: boolean }
  )[];
  startedAt: string;
  finishedAt: string;
}

interface RunScheduledJobCommand {
  jobName: string;
  executionKey: string;
  workerId: string;
  scheduledFor: string;
  deadlineAt: string;
}

interface ResumeJobCommand {
  runId: string;
  workerId: string;
  expectedCheckpoint?: string;
  asOf: string;
}

type ResumeResult =
  | { kind: "resumed"; result: JobExecutionResult }
  | { kind: "lease-protected"; run: JobRunView }
  | { kind: "stale-checkpoint"; run: JobRunView };

type HeartbeatResult =
  | { kind: "renewed"; run: JobRunView }
  | { kind: "stale-lease"; run: JobRunView };

interface OperationsObservation {
  kind: "job-outcome";
  jobName: string;
  executionKeyHash: string;
  status: "COMPLETE" | "PARTIAL_FAILURE" | "FAILED";
  failedTargets: number;
  retryableFailedTargets: number;
  observedAt: string;
}

interface ScheduledJobFixture {
  now: string;
  pages: readonly JobPageFixture[];
  existingRun?: JobRunView;
  /** 테스트 경계가 업무 handler의 중단을 재현하며 제품 API에는 노출되지 않습니다. */
  interruptionAfterCheckpoint?: string;
  topLevelFailure?: { code: string; retryable: boolean };
  maxPagesPerExecution?: number;
}

/** Scheduler SDK와 기능 Repository에서 독립적인 Operations 공개 계약입니다. */
export interface ScheduledJobExecutionSubject {
  run(command: RunScheduledJobCommand): Promise<JobExecutionResult>;
  resume(command: ResumeJobCommand): Promise<ResumeResult>;
  heartbeat(command: {
    runId: string;
    workerId: string;
    leaseToken: string;
    expectedCheckpoint?: string;
    asOf: string;
  }): Promise<HeartbeatResult>;
  getRun(runId: string): Promise<JobRunView | undefined>;
  observations(): readonly OperationsObservation[];
}

export function createSubject(
  fixture: ScheduledJobFixture,
): ScheduledJobExecutionSubject {
  return createScheduledJobExecutionFixture(fixture);
}

const command = (
  overrides: Partial<RunScheduledJobCommand> = {},
): RunScheduledJobCommand => ({
  jobName: "asset-valuation-daily",
  executionKey: "asset-valuation-daily:2026-07-19",
  workerId: "worker-a",
  scheduledFor: "2026-07-19T23:55:00+09:00",
  deadlineAt: "2026-07-20T00:30:00+09:00",
  ...overrides,
});

const successTarget = (targetId: string): TargetFixture => ({
  targetId,
  outcome: { kind: "SUCCEEDED", receipt: `receipt:${targetId}` },
});

const existingRun = (
  overrides: Partial<JobRunView> = {},
): JobRunView => ({
  runId: "run-1",
  jobName: "asset-valuation-daily",
  executionKey: "asset-valuation-daily:2026-07-19",
  status: "RUNNING",
  checkpoint: "page-1",
  lastHeartbeatAt: "2026-07-19T23:56:30+09:00",
  lease: {
    ownerId: "worker-a",
    expiresAt: "2026-07-20T00:01:00+09:00",
    attempt: 1,
    token: "lease-a",
  },
  targets: [
    {
      targetIdHash: "hash:asset-a",
      kind: "SUCCEEDED",
      receipt: "receipt:asset-a",
    },
  ],
  totals: { target: 1, succeeded: 1, skipped: 0, failed: 0 },
  ...overrides,
});

describe("예약 JobRun 실행·lease·부분 실패 공개 계약", () => {
  it("[T-JOB-001][JOB-ERR-001] 같은 occurrence 재전달은 하나의 run과 동일한 완료 결과로 수렴한다", async () => {
    const subject = createSubject({
      now: "2026-07-19T23:56:00+09:00",
      pages: [
        {
          checkpointAfter: "page-1",
          targets: [successTarget("asset-a"), successTarget("asset-b")],
        },
      ],
    });
    const request = command();

    const first = await subject.run(request);
    const replay = await subject.run({ ...request, workerId: "worker-b" });

    expect(first.status).toBe("COMPLETE");
    expect(replay).toEqual(first);
    expect(await subject.getRun(first.runId)).toMatchObject({
      runId: first.runId,
      jobName: request.jobName,
      executionKey: request.executionKey,
      status: "COMPLETE",
      totals: { target: 2, succeeded: 2, skipped: 0, failed: 0 },
      targets: expect.arrayContaining([
        expect.objectContaining({ kind: "SUCCEEDED", receipt: "receipt:asset-a" }),
        expect.objectContaining({ kind: "SUCCEEDED", receipt: "receipt:asset-b" }),
      ]),
    });
  });

  it("[T-JOB-001][JOB-ERR-001] 일부 target 실패를 COMPLETE로 축약하지 않고 실패 범위와 retryability를 보존한다", async () => {
    const subject = createSubject({
      now: "2026-07-19T23:56:00+09:00",
      pages: [
        {
          checkpointAfter: "page-1",
          targets: [
            successTarget("asset-a"),
            {
              targetId: "asset-b",
              outcome: {
                kind: "FAILED",
                code: "MARKET_TIMEOUT",
                retryable: true,
              },
            },
            {
              targetId: "asset-c",
              outcome: {
                kind: "FAILED",
                code: "INVALID_PROVIDER_DATA",
                retryable: false,
              },
            },
          ],
        },
      ],
    });

    const result = await subject.run(command());

    expect(result).toMatchObject({
      status: "PARTIAL_FAILURE",
      checkpoint: "page-1",
      totals: { target: 3, succeeded: 1, skipped: 0, failed: 2 },
    });
    expect(result.failures).toHaveLength(2);
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MARKET_TIMEOUT", retryable: true }),
      expect.objectContaining({ code: "INVALID_PROVIDER_DATA", retryable: false }),
    ]));
    expect(
      result.failures.every(
        (failure) =>
          failure.scope !== "target" ||
          (failure.targetIdHash !== "asset-b" && failure.targetIdHash !== "asset-c"),
      ),
    ).toBe(true);
    expect(subject.observations()).toContainEqual(
      expect.objectContaining({
        kind: "job-outcome",
        status: "PARTIAL_FAILURE",
        failedTargets: 2,
        retryableFailedTargets: 1,
      }),
    );
  });

  it("[T-JOB-001][JOB-ERR-001] 최상위 실패도 FAILED run과 redacted 관측 결과로 남긴다", async () => {
    const subject = createSubject({
      now: "2026-07-19T23:56:00+09:00",
      pages: [],
      topLevelFailure: { code: "TARGET_PAGE_UNAVAILABLE", retryable: true },
    });

    const result = await subject.run(command());

    expect(result.status).toBe("FAILED");
    expect(result.failures).toEqual([
      expect.objectContaining({
        scope: "job",
        code: "TARGET_PAGE_UNAVAILABLE",
        retryable: true,
      }),
    ]);
    expect(await subject.getRun(result.runId)).toMatchObject({ status: "FAILED" });
    expect(subject.observations()).toContainEqual(
      expect.objectContaining({ kind: "job-outcome", status: "FAILED" }),
    );
  });

  it("[T-JOB-001][JOB-ERR-001] 의도적으로 건너뛴 target은 실패가 아닌 완료 receipt로 집계한다", async () => {
    const subject = createSubject({
      now: "2026-07-19T23:56:00+09:00",
      pages: [
        {
          checkpointAfter: "page-1",
          targets: [
            successTarget("asset-a"),
            {
              targetId: "asset-b",
              outcome: { kind: "SKIPPED", receipt: "receipt:already-current" },
            },
          ],
        },
      ],
    });

    expect(await subject.run(command())).toMatchObject({
      status: "COMPLETE",
      totals: { target: 2, succeeded: 1, skipped: 1, failed: 0 },
      failures: [],
    });
  });

  it("[T-JOB-002][JOB-ERR-002] 유효한 lease는 다른 worker의 takeover로부터 보호된다", async () => {
    const current = existingRun();
    const subject = createSubject({
      now: "2026-07-19T23:58:00+09:00",
      pages: [],
      existingRun: current,
    });

    const result = await subject.resume({
      runId: current.runId,
      workerId: "worker-b",
      expectedCheckpoint: "page-1",
      asOf: "2026-07-19T23:58:00+09:00",
    });

    expect(result).toEqual({ kind: "lease-protected", run: current });
    expect(await subject.getRun(current.runId)).toEqual(current);
  });

  it("[T-JOB-002][JOB-ERR-002] 만료 lease takeover는 checkpoint 뒤 retryable 실패만 재개하고 성공 receipt를 다시 만들지 않는다", async () => {
    const current = existingRun({
      status: "PARTIAL_FAILURE",
      lastHeartbeatAt: "2026-07-19T23:56:00+09:00",
      lease: {
        ownerId: "worker-a",
        expiresAt: "2026-07-19T23:57:00+09:00",
        attempt: 1,
        token: "lease-a",
      },
      targets: [
        {
          targetIdHash: "hash:asset-a",
          kind: "SUCCEEDED",
          receipt: "receipt:asset-a",
        },
        {
          targetIdHash: "hash:asset-b",
          kind: "FAILED",
          code: "MARKET_TIMEOUT",
          retryable: true,
        },
      ],
      totals: { target: 2, succeeded: 1, skipped: 0, failed: 1 },
    });
    const subject = createSubject({
      now: "2026-07-19T23:58:00+09:00",
      existingRun: current,
      pages: [
        {
          checkpointBefore: "page-1",
          checkpointAfter: "page-2",
          targets: [successTarget("asset-b")],
        },
      ],
    });

    const resumed = await subject.resume({
      runId: current.runId,
      workerId: "worker-b",
      expectedCheckpoint: "page-1",
      asOf: "2026-07-19T23:58:00+09:00",
    });

    expect(resumed.kind).toBe("resumed");
    if (resumed.kind !== "resumed") return;
    expect(resumed.result).toMatchObject({
      runId: current.runId,
      status: "COMPLETE",
      checkpoint: "page-2",
      totals: { target: 2, succeeded: 2, skipped: 0, failed: 0 },
    });
    expect(await subject.getRun(current.runId)).toMatchObject({
      status: "COMPLETE",
      targets: expect.arrayContaining([
        {
          targetIdHash: "hash:asset-a",
          kind: "SUCCEEDED",
          receipt: "receipt:asset-a",
        },
        expect.objectContaining({ kind: "SUCCEEDED", receipt: "receipt:asset-b" }),
      ]),
    });
  });

  it("[T-JOB-002][JOB-ERR-002] 이전 lease token의 heartbeat는 상태와 checkpoint를 바꾸지 않는다", async () => {
    const current = existingRun({
      lease: {
        ownerId: "worker-b",
        expiresAt: "2026-07-20T00:03:00+09:00",
        attempt: 2,
        token: "lease-b",
      },
    });
    const subject = createSubject({
      now: "2026-07-19T23:59:00+09:00",
      pages: [],
      existingRun: current,
    });

    const result = await subject.heartbeat({
      runId: current.runId,
      workerId: "worker-a",
      leaseToken: "lease-a",
      expectedCheckpoint: "page-1",
      asOf: "2026-07-19T23:59:00+09:00",
    });

    expect(result).toEqual({ kind: "stale-lease", run: current });
    expect(await subject.getRun(current.runId)).toEqual(current);
  });

  it("[T-JOB-002][JOB-ERR-002] 현재 lease owner의 heartbeat만 lease를 연장하고 checkpoint를 보존한다", async () => {
    const current = existingRun();
    const subject = createSubject({
      now: "2026-07-19T23:59:00+09:00",
      pages: [],
      existingRun: current,
    });

    const result = await subject.heartbeat({
      runId: current.runId,
      workerId: "worker-a",
      leaseToken: "lease-a",
      expectedCheckpoint: "page-1",
      asOf: "2026-07-19T23:59:00+09:00",
    });

    expect(result.kind).toBe("renewed");
    if (result.kind !== "renewed") return;
    expect(result.run).toMatchObject({
      checkpoint: "page-1",
      lastHeartbeatAt: "2026-07-19T23:59:00+09:00",
      lease: { ownerId: "worker-a", token: "lease-a", attempt: 1 },
    });
    expect(Date.parse(result.run.lease!.expiresAt)).toBeGreaterThan(
      Date.parse(current.lease!.expiresAt),
    );
  });

  it("[T-JOB-002][JOB-ERR-002] page 저장 뒤 중단되어도 checkpoint와 성공 receipt에서 재개한다", async () => {
    const subject = createSubject({
      now: "2026-07-19T23:56:00+09:00",
      interruptionAfterCheckpoint: "page-1",
      pages: [
        { checkpointAfter: "page-1", targets: [successTarget("asset-a")] },
        {
          checkpointBefore: "page-1",
          checkpointAfter: "page-2",
          targets: [successTarget("asset-b")],
        },
      ],
    });

    await expect(subject.run(command())).rejects.toThrow("SIMULATED_JOB_INTERRUPTION");
    const interrupted = await subject.getRun(`run:${command().executionKey}`);
    expect(interrupted).toMatchObject({
      status: "RUNNING",
      checkpoint: "page-1",
      totals: { target: 1, succeeded: 1, skipped: 0, failed: 0 },
    });

    const resumed = await subject.resume({
      runId: interrupted!.runId,
      workerId: "worker-b",
      expectedCheckpoint: "page-1",
      asOf: "2026-07-20T00:02:00+09:00",
    });
    expect(resumed).toMatchObject({
      kind: "resumed",
      result: {
        status: "COMPLETE",
        checkpoint: "page-2",
        totals: { target: 2, succeeded: 2, skipped: 0, failed: 0 },
      },
    });
  });

  it("[T-JOB-002][JOB-ERR-002] stale checkpoint 재개 요청은 완료 범위를 되돌리지 않는다", async () => {
    const current = existingRun({
      checkpoint: "page-2",
      lease: {
        ownerId: "worker-b",
        expiresAt: "2026-07-20T00:05:00+09:00",
        attempt: 2,
        token: "lease-b",
      },
    });
    const subject = createSubject({
      now: "2026-07-20T00:02:00+09:00",
      pages: [],
      existingRun: current,
    });

    const result = await subject.resume({
      runId: current.runId,
      workerId: "worker-b",
      expectedCheckpoint: "page-1",
      asOf: "2026-07-20T00:02:00+09:00",
    });

    expect(result).toEqual({ kind: "stale-checkpoint", run: current });
    expect(await subject.getRun(current.runId)).toEqual(current);
  });

  it("[T-JOB-001][JOB-ERR-001] terminal page는 page 상한과 같아도 추가 page 없이 완료한다", async () => {
    const subject = createSubject({
      now: "2026-07-19T23:56:00+09:00",
      maxPagesPerExecution: 1,
      pages: [
        {
          checkpointAfter: "page-1",
          terminal: true,
          targets: [successTarget("asset-a")],
        },
      ],
    });

    await expect(subject.run(command())).resolves.toMatchObject({
      status: "COMPLETE",
      checkpoint: "page-1",
      totals: { target: 1, succeeded: 1, skipped: 0, failed: 0 },
    });
  });

  it("[T-JOB-001][JOB-ERR-001] page 상한을 넘길 작업은 다음 page를 시작하기 전에 실패한다", async () => {
    const subject = createSubject({
      now: "2026-07-19T23:56:00+09:00",
      maxPagesPerExecution: 1,
      pages: [
        {
          checkpointAfter: "page-1",
          targets: [successTarget("asset-a")],
        },
        {
          checkpointBefore: "page-1",
          checkpointAfter: "page-2",
          terminal: true,
          targets: [successTarget("asset-b")],
        },
      ],
    });

    const result = await subject.run(command());

    expect(result).toMatchObject({
      status: "FAILED",
      checkpoint: "page-1",
      totals: { target: 1, succeeded: 1, skipped: 0, failed: 0 },
      failures: [
        {
          scope: "job",
          code: "SCHEDULED_JOB_PAGE_LIMIT_EXCEEDED",
          retryable: true,
        },
      ],
    });

    await expect(
      subject.run(command({ workerId: "worker-b" })),
    ).resolves.toMatchObject({
      status: "COMPLETE",
      checkpoint: "page-2",
      totals: { target: 2, succeeded: 2, skipped: 0, failed: 0 },
    });
  });
});

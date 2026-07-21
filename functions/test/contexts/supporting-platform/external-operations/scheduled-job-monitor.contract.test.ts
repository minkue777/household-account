import { describe, expect, it } from "vitest";

import { createScheduledJobMonitorFixture } from "../../../support/scheduled-job-monitor-fixture";

type MonitoredJobStatus =
  | "EXPECTED"
  | "RUNNING"
  | "MISSING"
  | "OVERDUE"
  | "COMPLETE"
  | "PARTIAL_FAILURE"
  | "FAILED";

interface ExpectedOccurrenceView {
  occurrenceId: string;
  jobName: string;
  scheduledFor: string;
  startGraceDeadlineAt: string;
  executionDeadlineAt: string;
}

interface MonitoredJobRunView extends ExpectedOccurrenceView {
  status: MonitoredJobStatus;
  startedAt?: string;
  lastHeartbeatAt?: string;
  heartbeatDeadlineAt?: string;
  lease?: {
    ownerId: string;
    token: string;
    expiresAt: string;
  };
  checkpoint?: string;
  completedTargetReceipts: readonly string[];
}

interface JobIncidentView {
  incidentId: string;
  occurrenceId: string;
  state: "OPEN" | "RESOLVED";
  reason: "MISSING" | "HEARTBEAT_OVERDUE" | "DEADLINE_OVERDUE";
  openedAt: string;
  resolvedAt?: string;
  alertOpenCount: number;
  alertResolveCount: number;
}

interface JobMonitorTransition {
  occurrenceId: string;
  from: MonitoredJobStatus;
  to: MonitoredJobStatus;
  reason?: JobIncidentView["reason"];
}

interface JobMonitorResult {
  kind: "complete";
  monitorOccurrenceId: string;
  inspectedOccurrenceIds: readonly string[];
  transitions: readonly JobMonitorTransition[];
  openedIncidentIds: readonly string[];
  resolvedIncidentIds: readonly string[];
}

interface ScheduledJobMonitorFixture {
  expectedOccurrences: readonly ExpectedOccurrenceView[];
  runs?: readonly MonitoredJobRunView[];
  incidents?: readonly JobIncidentView[];
}

/** 실행 함수가 호출되지 않은 경우까지 감지하는 별도 occurrence monitor 계약입니다. */
export interface ScheduledJobMonitorSubject {
  detectMissingOrOverdueRuns(input: {
    monitorOccurrenceId: string;
    observedAt: string;
  }): Promise<JobMonitorResult>;
  recordRunRecovery(input: {
    occurrenceId: string;
    terminalStatus: "COMPLETE" | "PARTIAL_FAILURE" | "FAILED";
    recoveredAt: string;
  }): Promise<{ kind: "success"; run: MonitoredJobRunView }>;
  getRun(occurrenceId: string): Promise<MonitoredJobRunView>;
  getIncident(occurrenceId: string): Promise<JobIncidentView | undefined>;
  monitorReceipts(): readonly {
    monitorOccurrenceId: string;
    inspectedOccurrenceIds: readonly string[];
  }[];
}

export function createSubject(
  fixture: ScheduledJobMonitorFixture,
): ScheduledJobMonitorSubject {
  return createScheduledJobMonitorFixture(fixture);
}

const expected: ExpectedOccurrenceView = {
  occurrenceId: "asset-valuation:2026-07-19",
  jobName: "asset-valuation-daily",
  scheduledFor: "2026-07-19T23:55:00+09:00",
  startGraceDeadlineAt: "2026-07-20T00:00:00+09:00",
  executionDeadlineAt: "2026-07-20T00:30:00+09:00",
};

function running(
  overrides: Partial<MonitoredJobRunView> = {},
): MonitoredJobRunView {
  return {
    ...expected,
    status: "RUNNING",
    startedAt: "2026-07-19T23:56:00+09:00",
    lastHeartbeatAt: "2026-07-19T23:58:00+09:00",
    heartbeatDeadlineAt: "2026-07-20T00:03:00+09:00",
    lease: {
      ownerId: "worker-a",
      token: "lease-a",
      expiresAt: "2026-07-20T00:03:00+09:00",
    },
    checkpoint: "page-1",
    completedTargetReceipts: ["receipt:asset-a"],
    ...overrides,
  };
}

describe("예약 occurrence Missing·Overdue 감시 계약", () => {
  it("[T-JOB-002][JOB-ERR-002] grace가 지났는데 실행 기록이 없으면 Expected occurrence를 Missing으로 만들고 한 번 경보한다", async () => {
    const subject = createSubject({ expectedOccurrences: [expected] });

    const result = await subject.detectMissingOrOverdueRuns({
      monitorOccurrenceId: "monitor:2026-07-20T00:01",
      observedAt: "2026-07-20T00:01:00+09:00",
    });

    expect(result).toEqual({
      kind: "complete",
      monitorOccurrenceId: "monitor:2026-07-20T00:01",
      inspectedOccurrenceIds: [expected.occurrenceId],
      transitions: [
        {
          occurrenceId: expected.occurrenceId,
          from: "EXPECTED",
          to: "MISSING",
          reason: "MISSING",
        },
      ],
      openedIncidentIds: [expect.any(String)],
      resolvedIncidentIds: [],
    });
    expect(await subject.getRun(expected.occurrenceId)).toEqual({
      ...expected,
      status: "MISSING",
      completedTargetReceipts: [],
    });
    expect(await subject.getIncident(expected.occurrenceId)).toEqual(
      expect.objectContaining({
        occurrenceId: expected.occurrenceId,
        state: "OPEN",
        reason: "MISSING",
        openedAt: "2026-07-20T00:01:00+09:00",
        alertOpenCount: 1,
        alertResolveCount: 0,
      }),
    );
  });

  it("[T-JOB-002][JOB-ERR-002] 같은 장애를 monitor가 재검사해도 상태와 open 경보를 중복 생성하지 않는다", async () => {
    const subject = createSubject({ expectedOccurrences: [expected] });
    await subject.detectMissingOrOverdueRuns({
      monitorOccurrenceId: "monitor:first",
      observedAt: "2026-07-20T00:01:00+09:00",
    });

    const replay = await subject.detectMissingOrOverdueRuns({
      monitorOccurrenceId: "monitor:second",
      observedAt: "2026-07-20T00:02:00+09:00",
    });

    expect(replay).toMatchObject({
      kind: "complete",
      transitions: [],
      openedIncidentIds: [],
      resolvedIncidentIds: [],
    });
    expect(await subject.getIncident(expected.occurrenceId)).toEqual(
      expect.objectContaining({
        state: "OPEN",
        alertOpenCount: 1,
        alertResolveCount: 0,
      }),
    );
    expect(subject.monitorReceipts()).toHaveLength(2);
  });

  it.each([
    {
      label: "heartbeat deadline",
      run: running(),
      observedAt: "2026-07-20T00:04:00+09:00",
      reason: "HEARTBEAT_OVERDUE" as const,
    },
    {
      label: "execution deadline",
      run: running({
        lastHeartbeatAt: "2026-07-20T00:29:00+09:00",
        heartbeatDeadlineAt: "2026-07-20T00:34:00+09:00",
      }),
      observedAt: "2026-07-20T00:31:00+09:00",
      reason: "DEADLINE_OVERDUE" as const,
    },
  ])(
    "[T-JOB-002][JOB-ERR-002] $label 초과 실행은 완료 receipt와 checkpoint를 보존한 Overdue가 된다",
    async ({ run, observedAt, reason }) => {
      const subject = createSubject({
        expectedOccurrences: [expected],
        runs: [run],
      });

      const result = await subject.detectMissingOrOverdueRuns({
        monitorOccurrenceId: `monitor:${reason}`,
        observedAt,
      });

      expect(result.transitions).toEqual([
        {
          occurrenceId: expected.occurrenceId,
          from: "RUNNING",
          to: "OVERDUE",
          reason,
        },
      ]);
      expect(await subject.getRun(expected.occurrenceId)).toEqual({
        ...run,
        status: "OVERDUE",
      });
      expect(
        (await subject.getRun(expected.occurrenceId)).completedTargetReceipts,
      ).toEqual(["receipt:asset-a"]);
      expect((await subject.getRun(expected.occurrenceId)).checkpoint).toBe(
        "page-1",
      );
      expect(await subject.getIncident(expected.occurrenceId)).toEqual(
        expect.objectContaining({ state: "OPEN", reason, alertOpenCount: 1 }),
      );
    },
  );

  it("[T-JOB-002][JOB-ERR-002] terminal run은 과거 deadline이 지나도 Missing·Overdue로 역전하지 않는다", async () => {
    const complete = running({
      status: "COMPLETE",
      lease: undefined,
      heartbeatDeadlineAt: undefined,
    });
    const subject = createSubject({
      expectedOccurrences: [expected],
      runs: [complete],
    });

    expect(
      await subject.detectMissingOrOverdueRuns({
        monitorOccurrenceId: "monitor:after-complete",
        observedAt: "2026-07-21T00:00:00+09:00",
      }),
    ).toMatchObject({
      transitions: [],
      openedIncidentIds: [],
    });
    expect(await subject.getRun(expected.occurrenceId)).toEqual(complete);
    expect(await subject.getIncident(expected.occurrenceId)).toBeUndefined();
  });

  it("[T-JOB-002][JOB-ERR-002] grace와 heartbeat deadline 경계 시각 자체는 아직 Missing·Overdue가 아니다", async () => {
    const missingSubject = createSubject({ expectedOccurrences: [expected] });
    expect(
      await missingSubject.detectMissingOrOverdueRuns({
        monitorOccurrenceId: "monitor:grace-boundary",
        observedAt: expected.startGraceDeadlineAt,
      }),
    ).toMatchObject({ transitions: [], openedIncidentIds: [] });

    const runningSubject = createSubject({
      expectedOccurrences: [expected],
      runs: [running()],
    });
    expect(
      await runningSubject.detectMissingOrOverdueRuns({
        monitorOccurrenceId: "monitor:heartbeat-boundary",
        observedAt: running().heartbeatDeadlineAt!,
      }),
    ).toMatchObject({ transitions: [], openedIncidentIds: [] });
  });

  it("[T-JOB-002][JOB-ERR-002] 같은 monitor occurrence replay는 기존 검사 결과와 receipt 하나로 수렴한다", async () => {
    const subject = createSubject({ expectedOccurrences: [expected] });
    const request = {
      monitorOccurrenceId: "monitor:idempotent",
      observedAt: "2026-07-20T00:01:00+09:00",
    };

    const first = await subject.detectMissingOrOverdueRuns(request);
    const replay = await subject.detectMissingOrOverdueRuns(request);

    expect(replay).toEqual(first);
    expect(subject.monitorReceipts()).toHaveLength(1);
    expect((await subject.getIncident(expected.occurrenceId))?.alertOpenCount).toBe(1);
  });

  it("[T-JOB-002][JOB-ERR-002] Missing·Overdue 실행이 terminal로 복구되면 incident를 한 번 resolve한다", async () => {
    const incident: JobIncidentView = {
      incidentId: "incident-1",
      occurrenceId: expected.occurrenceId,
      state: "OPEN",
      reason: "HEARTBEAT_OVERDUE",
      openedAt: "2026-07-20T00:04:00+09:00",
      alertOpenCount: 1,
      alertResolveCount: 0,
    };
    const subject = createSubject({
      expectedOccurrences: [expected],
      runs: [running({ status: "OVERDUE" })],
      incidents: [incident],
    });

    const recovered = await subject.recordRunRecovery({
      occurrenceId: expected.occurrenceId,
      terminalStatus: "COMPLETE",
      recoveredAt: "2026-07-20T00:10:00+09:00",
    });
    expect(recovered).toEqual({
      kind: "success",
      run: expect.objectContaining({
        occurrenceId: expected.occurrenceId,
        status: "COMPLETE",
        checkpoint: "page-1",
        completedTargetReceipts: ["receipt:asset-a"],
      }),
    });

    const monitored = await subject.detectMissingOrOverdueRuns({
      monitorOccurrenceId: "monitor:recovery",
      observedAt: "2026-07-20T00:11:00+09:00",
    });
    expect(monitored).toMatchObject({
      openedIncidentIds: [],
      resolvedIncidentIds: ["incident-1"],
    });
    expect(await subject.getIncident(expected.occurrenceId)).toEqual({
      ...incident,
      state: "RESOLVED",
      resolvedAt: "2026-07-20T00:11:00+09:00",
      alertResolveCount: 1,
    });

    await subject.detectMissingOrOverdueRuns({
      monitorOccurrenceId: "monitor:recovery-replay",
      observedAt: "2026-07-20T00:12:00+09:00",
    });
    expect(await subject.getIncident(expected.occurrenceId)).toEqual(
      expect.objectContaining({
        state: "RESOLVED",
        alertOpenCount: 1,
        alertResolveCount: 1,
      }),
    );
  });
});

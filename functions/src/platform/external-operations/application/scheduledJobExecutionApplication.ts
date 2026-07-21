import type {
  JobExecutionResult,
  JobLease,
  JobRun,
  JobRunStatus,
  ScheduledJobExecutionInputPort,
  StoredJobTargetResult,
} from "./ports/in/scheduledJobExecutionInputPort";
import type {
  JobExecutionClockPort,
  JobExecutionIdentityPort,
  JobExecutionObservationPort,
  ScheduledFeaturePagePort,
  ScheduledJobRunRepositoryPort,
  TopLevelJobFailurePort,
} from "./ports/out/scheduledJobExecutionPorts";

const LEASE_DURATION_MS = 5 * 60 * 1_000;

function plusLeaseDuration(value: string, durationMs: number): string {
  return new Date(Date.parse(value) + durationMs).toISOString();
}

function leaseActive(lease: JobLease | undefined, asOf: string): boolean {
  return lease !== undefined && Date.parse(lease.expiresAt) > Date.parse(asOf);
}

function totals(targets: readonly StoredJobTargetResult[]): JobRun["totals"] {
  return {
    target: targets.length,
    succeeded: targets.filter(({ kind }) => kind === "SUCCEEDED").length,
    skipped: targets.filter(({ kind }) => kind === "SKIPPED").length,
    failed: targets.filter(({ kind }) => kind === "FAILED").length,
  };
}

function statusFor(targets: readonly StoredJobTargetResult[]): Exclude<JobRunStatus, "RUNNING" | "OVERDUE"> {
  const count = totals(targets);
  if (count.failed === 0) return "COMPLETE";
  return count.succeeded + count.skipped > 0 ? "PARTIAL_FAILURE" : "FAILED";
}

function isRetryableJobFailure(result: JobExecutionResult): boolean {
  return (
    result.status === "FAILED" &&
    result.failures.length > 0 &&
    result.failures.every(
      (failure) => failure.scope === "job" && failure.retryable,
    )
  );
}

export function createScheduledJobExecutionApplication(dependencies: {
  readonly pages: ScheduledFeaturePagePort;
  readonly repository: ScheduledJobRunRepositoryPort;
  readonly observations: JobExecutionObservationPort;
  readonly identity: JobExecutionIdentityPort;
  readonly clock: JobExecutionClockPort;
  readonly topLevelFailure: TopLevelJobFailurePort;
  readonly leaseDurationMs?: number;
  readonly maxPagesPerExecution?: number;
}): ScheduledJobExecutionInputPort {
  const leaseDurationMs = dependencies.leaseDurationMs ?? LEASE_DURATION_MS;
  const maxPagesPerExecution =
    dependencies.maxPagesPerExecution ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0) {
    throw new Error("INVALID_JOB_LEASE_DURATION");
  }
  if (
    !Number.isSafeInteger(maxPagesPerExecution) ||
    maxPagesPerExecution <= 0
  ) {
    throw new Error("INVALID_JOB_MAX_PAGES");
  }
  async function finish(run: JobRun, startedAt: string): Promise<JobExecutionResult> {
    const status = statusFor(run.targets);
    const finalRun: JobRun = {
      ...run,
      status,
      lease: undefined,
      totals: totals(run.targets),
    };
    const finishedAt = dependencies.clock.now();
    const failures = finalRun.targets
      .filter((target): target is StoredJobTargetResult & {
        code: string;
        retryable: boolean;
      } => target.kind === "FAILED" && target.code !== undefined && target.retryable !== undefined)
      .map((target) => ({
        scope: "target" as const,
        targetIdHash: target.targetIdHash,
        code: target.code,
        retryable: target.retryable,
      }));
    const result: JobExecutionResult = {
      runId: finalRun.runId,
      jobName: finalRun.jobName,
      status,
      ...(finalRun.checkpoint === undefined ? {} : { checkpoint: finalRun.checkpoint }),
      totals: finalRun.totals,
      failures,
      startedAt,
      finishedAt,
    };
    await dependencies.repository.saveRun(finalRun);
    await dependencies.repository.saveResult(result);
    dependencies.observations.record({
      kind: "job-outcome",
      jobName: finalRun.jobName,
      executionKeyHash: dependencies.identity.hash(finalRun.executionKey),
      status,
      failedTargets: finalRun.totals.failed,
      retryableFailedTargets: failures.filter(({ retryable }) => retryable).length,
      observedAt: finishedAt,
    });
    return result;
  }

  async function processPages(
    run: JobRun,
    startedAt: string,
    deadlineAt: string,
  ): Promise<JobExecutionResult> {
    let current = run;
    let processedPages = 0;
    while (true) {
      if (Date.parse(dependencies.clock.now()) >= Date.parse(deadlineAt)) {
        return failAtTopLevel(current, startedAt, {
          code: "SCHEDULED_JOB_DEADLINE_EXCEEDED",
          retryable: true,
        });
      }
      if (processedPages >= maxPagesPerExecution) {
        return failAtTopLevel(current, startedAt, {
          code: "SCHEDULED_JOB_PAGE_LIMIT_EXCEEDED",
          retryable: true,
        });
      }
      const page = await dependencies.pages.nextPage(current.checkpoint);
      if (page === undefined) return finish(current, startedAt);

      const byHash = new Map(current.targets.map((target) => [target.targetIdHash, target]));
      for (const target of page.targets) {
        const targetIdHash = dependencies.identity.hash(target.targetId);
        const previous = byHash.get(targetIdHash);
        if (
          previous?.kind === "SUCCEEDED" ||
          previous?.kind === "SKIPPED" ||
          (previous?.kind === "FAILED" && previous.retryable === false)
        ) {
          continue;
        }
        const stored: StoredJobTargetResult = target.outcome.kind === "FAILED"
          ? {
              targetIdHash,
              kind: "FAILED",
              code: target.outcome.code,
              retryable: target.outcome.retryable,
            }
          : {
              targetIdHash,
              kind: target.outcome.kind,
              receipt: target.outcome.receipt,
            };
        byHash.set(targetIdHash, stored);
      }
      const heartbeatAt = dependencies.clock.now();
      current = {
        ...current,
        checkpoint: page.checkpointAfter,
        lastHeartbeatAt: heartbeatAt,
        ...(current.lease === undefined
          ? {}
          : {
              lease: {
                ...current.lease,
                expiresAt: plusLeaseDuration(heartbeatAt, leaseDurationMs),
              },
            }),
        targets: [...byHash.values()],
        totals: totals([...byHash.values()]),
      };
      await dependencies.repository.saveRun(current);
      processedPages += 1;
      if (page.terminal === true) return finish(current, startedAt);
    }
  }

  async function failAtTopLevel(run: JobRun, startedAt: string, failure: {
    readonly code: string;
    readonly retryable: boolean;
  }): Promise<JobExecutionResult> {
    const failedRun: JobRun = { ...run, status: "FAILED", lease: undefined };
    const finishedAt = dependencies.clock.now();
    const result: JobExecutionResult = {
      runId: run.runId,
      jobName: run.jobName,
      status: "FAILED",
      ...(run.checkpoint === undefined ? {} : { checkpoint: run.checkpoint }),
      totals: run.totals,
      failures: [{ scope: "job", ...failure }],
      startedAt,
      finishedAt,
    };
    await dependencies.repository.saveRun(failedRun);
    await dependencies.repository.saveResult(result);
    dependencies.observations.record({
      kind: "job-outcome",
      jobName: run.jobName,
      executionKeyHash: dependencies.identity.hash(run.executionKey),
      status: "FAILED",
      failedTargets: run.totals.failed,
      retryableFailedTargets: 0,
      observedAt: finishedAt,
    });
    return result;
  }

  return {
    async run(command) {
      const existing = await dependencies.repository.findByExecutionKey(
        command.executionKey,
      );
      if (existing !== undefined) {
        const result = await dependencies.repository.getResult(existing.runId);
        if (result !== undefined && !isRetryableJobFailure(result)) return result;
      }

      const startedAt = dependencies.clock.now();
      const runId = dependencies.identity.runId(command);
      if (existing !== undefined && leaseActive(existing.lease, startedAt)) {
        throw new Error("SCHEDULED_JOB_LEASE_PROTECTED");
      }
      const attempt = (existing?.lease?.attempt ?? 0) + 1;
      const run: JobRun = {
        ...(existing ?? {
          runId,
          jobName: command.jobName,
          executionKey: command.executionKey,
          targets: [],
          totals: { target: 0, succeeded: 0, skipped: 0, failed: 0 },
        }),
        status: "RUNNING",
        lease: {
          ownerId: command.workerId,
          expiresAt: plusLeaseDuration(startedAt, leaseDurationMs),
          attempt,
          token: dependencies.identity.leaseToken(runId, attempt),
        },
        lastHeartbeatAt: startedAt,
      };
      await dependencies.repository.saveRun(run);
      const topLevelFailure = dependencies.topLevelFailure.failure();
      return topLevelFailure === undefined
        ? processPages(run, startedAt, command.deadlineAt)
        : failAtTopLevel(run, startedAt, topLevelFailure);
    },

    async resume(command) {
      const run = await dependencies.repository.getRun(command.runId);
      if (run === undefined) throw new Error("JOB_RUN_NOT_FOUND");
      if (command.expectedCheckpoint !== run.checkpoint) {
        return { kind: "stale-checkpoint", run };
      }
      if (leaseActive(run.lease, command.asOf) && run.lease?.ownerId !== command.workerId) {
        return { kind: "lease-protected", run };
      }
      const attempt = (run.lease?.attempt ?? 0) + 1;
      const resumed: JobRun = {
        ...run,
        status: "RUNNING",
        lease: {
          ownerId: command.workerId,
          expiresAt: plusLeaseDuration(command.asOf, leaseDurationMs),
          attempt,
          token: dependencies.identity.leaseToken(run.runId, attempt),
        },
        lastHeartbeatAt: command.asOf,
      };
      await dependencies.repository.saveRun(resumed);
      return {
        kind: "resumed",
        result: await processPages(
          resumed,
          command.asOf,
          plusLeaseDuration(command.asOf, leaseDurationMs),
        ),
      };
    },

    async heartbeat(command) {
      const run = await dependencies.repository.getRun(command.runId);
      if (
        run === undefined ||
        run.lease === undefined ||
        run.lease.ownerId !== command.workerId ||
        run.lease.token !== command.leaseToken ||
        run.checkpoint !== command.expectedCheckpoint
      ) {
        if (run === undefined) throw new Error("JOB_RUN_NOT_FOUND");
        return { kind: "stale-lease", run };
      }
      const renewed: JobRun = {
        ...run,
        lastHeartbeatAt: command.asOf,
        lease: {
          ...run.lease,
          expiresAt: plusLeaseDuration(command.asOf, leaseDurationMs),
        },
      };
      await dependencies.repository.saveRun(renewed);
      return { kind: "renewed", run: renewed };
    },

    getRun: (runId) => dependencies.repository.getRun(runId),
  };
}

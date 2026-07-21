import { createScheduledJobExecutionApplication } from "../../src/platform/external-operations/application/scheduledJobExecutionApplication";
import type {
  JobExecutionResult,
  JobRun,
  RunScheduledJobCommand,
} from "../../src/platform/external-operations/public";

interface PageFixture {
  readonly checkpointBefore?: string;
  readonly checkpointAfter?: string;
  readonly terminal?: boolean;
  readonly targets: readonly {
    readonly targetId: string;
    readonly outcome:
      | { readonly kind: "SUCCEEDED"; readonly receipt: string }
      | { readonly kind: "SKIPPED"; readonly receipt: string }
      | { readonly kind: "FAILED"; readonly code: string; readonly retryable: boolean };
  }[];
}

export function createScheduledJobExecutionFixture(fixture: {
  readonly now: string;
  readonly pages: readonly PageFixture[];
  readonly existingRun?: JobRun;
  readonly interruptionAfterCheckpoint?: string;
  readonly topLevelFailure?: { readonly code: string; readonly retryable: boolean };
  readonly maxPagesPerExecution?: number;
}) {
  const runs = new Map<string, JobRun>();
  const executionIndex = new Map<string, string>();
  const results = new Map<string, JobExecutionResult>();
  const observations: {
    kind: "job-outcome";
    jobName: string;
    executionKeyHash: string;
    status: "COMPLETE" | "PARTIAL_FAILURE" | "FAILED";
    failedTargets: number;
    retryableFailedTargets: number;
    observedAt: string;
  }[] = [];
  const interrupted = new Set<string>();

  if (fixture.existingRun !== undefined) {
    runs.set(fixture.existingRun.runId, fixture.existingRun);
    executionIndex.set(fixture.existingRun.executionKey, fixture.existingRun.runId);
  }

  const application = createScheduledJobExecutionApplication({
    pages: {
      async nextPage(checkpoint) {
        if (
          checkpoint !== undefined &&
          fixture.interruptionAfterCheckpoint === checkpoint &&
          !interrupted.has(checkpoint)
        ) {
          interrupted.add(checkpoint);
          throw new Error("SIMULATED_JOB_INTERRUPTION");
        }
        return fixture.pages.find((page) => page.checkpointBefore === checkpoint);
      },
    },
    repository: {
      async findByExecutionKey(executionKey) {
        const runId = executionIndex.get(executionKey);
        return runId === undefined ? undefined : runs.get(runId);
      },
      async getRun(runId) {
        return runs.get(runId);
      },
      async saveRun(run) {
        runs.set(run.runId, run);
        executionIndex.set(run.executionKey, run.runId);
      },
      async getResult(runId) {
        return results.get(runId);
      },
      async saveResult(result) {
        results.set(result.runId, result);
      },
    },
    observations: { record: (entry) => observations.push({ ...entry }) },
    identity: {
      runId: (request: RunScheduledJobCommand) => `run:${request.executionKey}`,
      leaseToken: (runId, attempt) => `lease:${runId}:${attempt}`,
      hash: (value) => `hash:${value}`,
    },
    clock: { now: () => fixture.now },
    topLevelFailure: { failure: () => fixture.topLevelFailure },
    maxPagesPerExecution: fixture.maxPagesPerExecution,
  });

  return {
    ...application,
    observations: () => observations.map((entry) => ({ ...entry })),
  };
}

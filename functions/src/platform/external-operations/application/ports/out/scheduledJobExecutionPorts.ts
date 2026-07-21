import type {
  JobExecutionResult,
  JobRun,
  RunScheduledJobCommand,
} from "../in/scheduledJobExecutionInputPort";

export interface ScheduledTargetOutcome {
  readonly targetId: string;
  readonly outcome:
    | { readonly kind: "SUCCEEDED"; readonly receipt: string }
    | { readonly kind: "SKIPPED"; readonly receipt: string }
    | { readonly kind: "FAILED"; readonly code: string; readonly retryable: boolean };
}

export interface ScheduledTargetPage {
  readonly checkpointBefore?: string;
  readonly checkpointAfter?: string;
  /** true이면 이 page가 occurrence의 마지막 page입니다. */
  readonly terminal?: boolean;
  readonly targets: readonly ScheduledTargetOutcome[];
}

export interface ScheduledFeaturePagePort {
  nextPage(checkpoint?: string): Promise<ScheduledTargetPage | undefined>;
}

export interface ScheduledJobRunRepositoryPort {
  findByExecutionKey(executionKey: string): Promise<JobRun | undefined>;
  getRun(runId: string): Promise<JobRun | undefined>;
  saveRun(run: JobRun): Promise<void>;
  getResult(runId: string): Promise<JobExecutionResult | undefined>;
  saveResult(result: JobExecutionResult): Promise<void>;
}

export interface JobExecutionObservationPort {
  record(input: {
    readonly kind: "job-outcome";
    readonly jobName: string;
    readonly executionKeyHash: string;
    readonly status: "COMPLETE" | "PARTIAL_FAILURE" | "FAILED";
    readonly failedTargets: number;
    readonly retryableFailedTargets: number;
    readonly observedAt: string;
  }): void;
}

export interface JobExecutionIdentityPort {
  runId(command: RunScheduledJobCommand): string;
  leaseToken(runId: string, attempt: number): string;
  hash(value: string): string;
}

export interface JobExecutionClockPort {
  now(): string;
}

export interface TopLevelJobFailurePort {
  failure(): { readonly code: string; readonly retryable: boolean } | undefined;
}

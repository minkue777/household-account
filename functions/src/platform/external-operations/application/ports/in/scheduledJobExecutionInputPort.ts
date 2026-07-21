export type JobRunStatus =
  | "RUNNING"
  | "COMPLETE"
  | "PARTIAL_FAILURE"
  | "FAILED"
  | "OVERDUE";

export interface StoredJobTargetResult {
  readonly targetIdHash: string;
  readonly kind: "SUCCEEDED" | "SKIPPED" | "FAILED";
  readonly receipt?: string;
  readonly code?: string;
  readonly retryable?: boolean;
}

export interface JobLease {
  readonly ownerId: string;
  readonly expiresAt: string;
  readonly attempt: number;
  readonly token: string;
}

export interface JobRun {
  readonly runId: string;
  readonly jobName: string;
  readonly executionKey: string;
  readonly status: JobRunStatus;
  readonly checkpoint?: string;
  readonly lease?: JobLease;
  readonly lastHeartbeatAt?: string;
  readonly targets: readonly StoredJobTargetResult[];
  readonly totals: {
    readonly target: number;
    readonly succeeded: number;
    readonly skipped: number;
    readonly failed: number;
  };
}

export interface JobExecutionResult {
  readonly runId: string;
  readonly jobName: string;
  readonly status: "COMPLETE" | "PARTIAL_FAILURE" | "FAILED";
  readonly checkpoint?: string;
  readonly totals: JobRun["totals"];
  readonly failures: readonly (
    | {
        readonly scope: "target";
        readonly targetIdHash: string;
        readonly code: string;
        readonly retryable: boolean;
      }
    | { readonly scope: "job"; readonly code: string; readonly retryable: boolean }
  )[];
  readonly startedAt: string;
  readonly finishedAt: string;
}

export interface RunScheduledJobCommand {
  readonly jobName: string;
  readonly executionKey: string;
  readonly workerId: string;
  readonly scheduledFor: string;
  readonly deadlineAt: string;
}

export type ResumeJobResult =
  | { readonly kind: "resumed"; readonly result: JobExecutionResult }
  | { readonly kind: "lease-protected"; readonly run: JobRun }
  | { readonly kind: "stale-checkpoint"; readonly run: JobRun };

export type JobHeartbeatResult =
  | { readonly kind: "renewed"; readonly run: JobRun }
  | { readonly kind: "stale-lease"; readonly run: JobRun };

export interface ScheduledJobExecutionInputPort {
  run(command: RunScheduledJobCommand): Promise<JobExecutionResult>;
  resume(input: {
    readonly runId: string;
    readonly workerId: string;
    readonly expectedCheckpoint?: string;
    readonly asOf: string;
  }): Promise<ResumeJobResult>;
  heartbeat(input: {
    readonly runId: string;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly expectedCheckpoint?: string;
    readonly asOf: string;
  }): Promise<JobHeartbeatResult>;
  getRun(runId: string): Promise<JobRun | undefined>;
}

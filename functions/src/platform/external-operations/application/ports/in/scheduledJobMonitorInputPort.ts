export type MonitoredJobStatus =
  | "EXPECTED"
  | "RUNNING"
  | "MISSING"
  | "OVERDUE"
  | "COMPLETE"
  | "PARTIAL_FAILURE"
  | "FAILED";

export interface ExpectedScheduledOccurrence {
  readonly occurrenceId: string;
  readonly jobName: string;
  readonly scheduledFor: string;
  readonly startGraceDeadlineAt: string;
  readonly executionDeadlineAt: string;
}

export interface MonitoredJobRun extends ExpectedScheduledOccurrence {
  readonly status: MonitoredJobStatus;
  readonly startedAt?: string;
  readonly lastHeartbeatAt?: string;
  readonly heartbeatDeadlineAt?: string;
  readonly lease?: {
    readonly ownerId: string;
    readonly token: string;
    readonly expiresAt: string;
  };
  readonly checkpoint?: string;
  readonly completedTargetReceipts: readonly string[];
}

export interface JobIncident {
  readonly incidentId: string;
  readonly occurrenceId: string;
  readonly state: "OPEN" | "RESOLVED";
  readonly reason: "MISSING" | "HEARTBEAT_OVERDUE" | "DEADLINE_OVERDUE";
  readonly openedAt: string;
  readonly resolvedAt?: string;
  readonly alertOpenCount: number;
  readonly alertResolveCount: number;
}

export interface JobMonitorResult {
  readonly kind: "complete";
  readonly monitorOccurrenceId: string;
  readonly inspectedOccurrenceIds: readonly string[];
  readonly transitions: readonly {
    readonly occurrenceId: string;
    readonly from: MonitoredJobStatus;
    readonly to: MonitoredJobStatus;
    readonly reason?: JobIncident["reason"];
  }[];
  readonly openedIncidentIds: readonly string[];
  readonly resolvedIncidentIds: readonly string[];
}

export interface ScheduledJobMonitorInputPort {
  detectMissingOrOverdueRuns(input: {
    readonly monitorOccurrenceId: string;
    readonly observedAt: string;
  }): Promise<JobMonitorResult>;
  recordRunRecovery(input: {
    readonly occurrenceId: string;
    readonly terminalStatus: "COMPLETE" | "PARTIAL_FAILURE" | "FAILED";
    readonly recoveredAt: string;
  }): Promise<{ readonly kind: "success"; readonly run: MonitoredJobRun }>;
  getRun(occurrenceId: string): Promise<MonitoredJobRun>;
  getIncident(occurrenceId: string): Promise<JobIncident | undefined>;
}

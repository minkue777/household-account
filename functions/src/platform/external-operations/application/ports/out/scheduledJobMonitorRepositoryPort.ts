import type {
  ExpectedScheduledOccurrence,
  JobIncident,
  JobMonitorResult,
  MonitoredJobRun,
} from "../in/scheduledJobMonitorInputPort";

export interface ScheduledJobMonitorRepositoryPort {
  listExpectedOccurrences(): Promise<readonly ExpectedScheduledOccurrence[]>;
  getRun(occurrenceId: string): Promise<MonitoredJobRun | undefined>;
  saveRun(run: MonitoredJobRun): Promise<void>;
  getIncident(occurrenceId: string): Promise<JobIncident | undefined>;
  saveIncident(incident: JobIncident): Promise<void>;
  getMonitorReceipt(monitorOccurrenceId: string): Promise<JobMonitorResult | undefined>;
  saveMonitorReceipt(result: JobMonitorResult): Promise<void>;
}

export interface JobIncidentIdentityPort {
  forOccurrence(occurrenceId: string): string;
}

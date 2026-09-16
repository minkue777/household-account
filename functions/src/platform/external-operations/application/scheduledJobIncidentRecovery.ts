export interface ScheduledJobRecoveryRun {
  readonly occurrenceId?: string;
  readonly runId?: string;
  readonly jobName?: string;
  readonly status?: string;
  readonly scheduledFor?: string;
}

/** Missing/overdue is a liveness alarm. Preserve the failed run as history. */
export function hasScheduledJobRecovered(
  incident: { readonly occurrenceId: string; readonly openedAt: string },
  run: ScheduledJobRecoveryRun,
): boolean {
  if (incident.occurrenceId === (run.occurrenceId ?? run.runId)) {
    return run.status === "COMPLETE" || run.status === "PARTIAL_FAILURE" || run.status === "FAILED";
  }
  // A later successful occurrence restores this job's health, not other jobs.
  // Requiring a schedule after the alarm prevents an old/late completion hiding it.
  return run.status === "COMPLETE" && typeof run.jobName === "string"
    && incident.occurrenceId.startsWith(`${run.jobName}:`)
    && Date.parse(run.scheduledFor ?? "") > Date.parse(incident.openedAt);
}

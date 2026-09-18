import type * as firestore from 'firebase-admin/firestore';
import type { JobRun } from '../../../platform/external-operations/application/ports/in/scheduledJobExecutionInputPort';
import type { MonitoredJobStatus } from '../../../platform/external-operations/application/ports/in/scheduledJobMonitorInputPort';

export interface ScheduledJobStatus {
  readonly occurrenceId: string;
  readonly jobName: string;
  readonly scheduledFor: string;
  readonly status: MonitoredJobStatus;
  readonly lastUpdatedAt: string;
  readonly totals?: JobRun['totals'];
}

export interface ScheduledJobStatusSummary {
  readonly schemaVersion: 1;
  readonly jobName: string;
  readonly latestRun: ScheduledJobStatus;
  readonly latestSuccessfulRun?: ScheduledJobStatus;
}

const statuses = new Set(['EXPECTED', 'RUNNING', 'MISSING', 'OVERDUE', 'COMPLETE', 'PARTIAL_FAILURE', 'FAILED']);
function instant(value: unknown): string | undefined {
  const date = typeof value === 'string' ? new Date(value) : value instanceof Date ? value
    : value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function' ? value.toDate() as Date : undefined;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

/** Only public operational status, never leases, target receipts or failure payloads. */
export function scheduledJobStatus(data: Readonly<Record<string, unknown>>, updatedAt?: string): ScheduledJobStatus | undefined {
  const occurrenceId = data.occurrenceId ?? data.runId;
  const scheduledFor = instant(data.scheduledFor);
  if (typeof occurrenceId !== 'string' || !occurrenceId || typeof data.jobName !== 'string' || !data.jobName
    || !scheduledFor || typeof data.status !== 'string' || !statuses.has(data.status)) return undefined;
  const totals = data.totals as JobRun['totals'] | undefined;
  const validTotals = totals && ['target', 'succeeded', 'skipped', 'failed'].every(key =>
    Number.isSafeInteger(totals[key as keyof typeof totals]) && totals[key as keyof typeof totals] >= 0);
  return { occurrenceId, jobName: data.jobName, scheduledFor, status: data.status as MonitoredJobStatus,
    lastUpdatedAt: instant(updatedAt) ?? instant(data.lastUpdatedAt) ?? instant(data.terminalAt)
      ?? instant(data.lastHeartbeatAt) ?? instant(data.updatedAt) ?? scheduledFor,
    ...(validTotals ? { totals: { target: totals.target, succeeded: totals.succeeded, skipped: totals.skipped, failed: totals.failed } } : {}) };
}

export function readScheduledJobStatusSummary(data: firestore.DocumentData | undefined): ScheduledJobStatusSummary | undefined {
  if (!data) return undefined;
  const latestRun = scheduledJobStatus(data.latestRun ?? {});
  const latestSuccessfulRun = data.latestSuccessfulRun === undefined ? undefined : scheduledJobStatus(data.latestSuccessfulRun);
  if (data.schemaVersion !== 1 || typeof data.jobName !== 'string' || latestRun?.jobName !== data.jobName
    || (data.latestSuccessfulRun !== undefined && (latestSuccessfulRun?.jobName !== data.jobName || latestSuccessfulRun.status !== 'COMPLETE'))) {
    throw new Error('SCHEDULED_JOB_SUMMARY_INVALID');
  }
  return { schemaVersion: 1, jobName: data.jobName, latestRun, ...(latestSuccessfulRun ? { latestSuccessfulRun } : {}) };
}

function later(candidate: ScheduledJobStatus, current: ScheduledJobStatus | undefined): boolean {
  if (!current) return true;
  if (candidate.scheduledFor !== current.scheduledFor) return candidate.scheduledFor > current.scheduledFor;
  if (candidate.occurrenceId !== current.occurrenceId) return candidate.occurrenceId > current.occurrenceId;
  // The source run and summary share the transaction; lease/monitor checks decide
  // whether this occurrence may change. Wall-clock skew must not block its state.
  return true;
}

/** Schedule order wins over finish order: an old retry cannot replace today's run. */
export function advanceScheduledJobStatusSummary(current: ScheduledJobStatusSummary | undefined, candidate: ScheduledJobStatus): ScheduledJobStatusSummary {
  if (current && current.jobName !== candidate.jobName) throw new Error('SCHEDULED_JOB_SUMMARY_SCOPE_MISMATCH');
  const latestRun = later(candidate, current?.latestRun) ? candidate : current!.latestRun;
  const latestSuccessfulRun = candidate.status === 'COMPLETE' && later(candidate, current?.latestSuccessfulRun)
    ? candidate : current?.latestSuccessfulRun;
  return { schemaVersion: 1, jobName: candidate.jobName, latestRun, ...(latestSuccessfulRun ? { latestSuccessfulRun } : {}) };
}

export function scheduledJobStatusSummaryReference(database: firestore.Firestore, jobName: string) {
  return database.collection('operations').doc('runtime').collection('scheduledJobStatuses').doc(jobName);
}

/** The caller reads this document before staging any transaction writes. */
export function writeScheduledJobStatusSummary(transaction: firestore.Transaction, snapshot: firestore.DocumentSnapshot,
  data: Readonly<Record<string, unknown>>, updatedAt: string): void {
  const candidate = scheduledJobStatus(data, updatedAt);
  // Unscheduled executions do not appear in the scheduled dashboard, as before.
  if (!candidate) return;
  const current = readScheduledJobStatusSummary(snapshot.data());
  const next = advanceScheduledJobStatusSummary(current, candidate);
  if (JSON.stringify(current) !== JSON.stringify(next)) transaction.set(snapshot.ref, next);
}

import { createHash, randomUUID } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";

import type {
  JobExecutionResult,
  JobRun,
  RunScheduledJobCommand,
} from "../../../platform/external-operations/application/ports/in/scheduledJobExecutionInputPort";
import type {
  ExpectedScheduledOccurrence,
  JobIncident,
  JobMonitorResult,
  MonitoredJobRun,
} from "../../../platform/external-operations/application/ports/in/scheduledJobMonitorInputPort";
import type {
  JobExecutionClockPort,
  JobExecutionIdentityPort,
  JobExecutionObservationPort,
  ScheduledJobRunRepositoryPort,
  TopLevelJobFailurePort,
} from "../../../platform/external-operations/application/ports/out/scheduledJobExecutionPorts";
import type {
  JobIncidentIdentityPort,
  ScheduledJobMonitorRepositoryPort,
} from "../../../platform/external-operations/application/ports/out/scheduledJobMonitorRepositoryPort";
import type { ScheduledJobDefinition } from "../../../operations/scheduling/scheduledJobDefinitions";
import { firestoreTtlAfter } from "../shared/firestoreTtl";

const OPERATIONS_DOCUMENT = "runtime";

function operationsCollection(
  database: firestore.Firestore,
  name: string,
): firestore.CollectionReference {
  return database.collection("operations").doc(OPERATIONS_DOCUMENT).collection(name);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("SCHEDULED_JOB_DOCUMENT_INVALID");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(code);
  return value;
}

function plusSeconds(value: string, seconds: number): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("SCHEDULED_FOR_INVALID");
  return new Date(parsed + seconds * 1_000).toISOString();
}

function toExecutionRun(snapshot: firestore.DocumentSnapshot): JobRun | undefined {
  if (!snapshot.exists) return undefined;
  const data = asRecord(snapshot.data());
  if (data.status === "EXPECTED" || data.status === "MISSING") return undefined;
  if (
    typeof data.runId !== "string" ||
    typeof data.jobName !== "string" ||
    typeof data.executionKey !== "string" ||
    typeof data.status !== "string" ||
    !Array.isArray(data.targets) ||
    typeof data.totals !== "object" ||
    data.totals === null
  ) {
    throw new Error("SCHEDULED_JOB_RUN_INVALID");
  }
  return {
    runId: data.runId,
    jobName: data.jobName,
    executionKey: data.executionKey,
    status: data.status as JobRun["status"],
    ...(typeof data.checkpoint === "string" ? { checkpoint: data.checkpoint } : {}),
    ...(typeof data.lastHeartbeatAt === "string"
      ? { lastHeartbeatAt: data.lastHeartbeatAt }
      : {}),
    ...(typeof data.lease === "object" && data.lease !== null
      ? { lease: data.lease as JobRun["lease"] }
      : {}),
    targets: data.targets as unknown as JobRun["targets"],
    totals: data.totals as JobRun["totals"],
  };
}

function toExecutionResult(
  snapshot: firestore.DocumentSnapshot,
): JobExecutionResult | undefined {
  if (!snapshot.exists) return undefined;
  return snapshot.data() as JobExecutionResult;
}

function expectedFrom(data: Record<string, unknown>): ExpectedScheduledOccurrence {
  return {
    occurrenceId: requiredString(data.occurrenceId, "OCCURRENCE_ID_INVALID"),
    jobName: requiredString(data.jobName, "JOB_NAME_INVALID"),
    scheduledFor: requiredString(data.scheduledFor, "SCHEDULED_FOR_INVALID"),
    startGraceDeadlineAt: requiredString(
      data.startGraceDeadlineAt,
      "START_GRACE_DEADLINE_INVALID",
    ),
    executionDeadlineAt: requiredString(
      data.executionDeadlineAt,
      "EXECUTION_DEADLINE_INVALID",
    ),
  };
}

function toMonitoredRun(
  snapshot: firestore.DocumentSnapshot,
): MonitoredJobRun | undefined {
  if (!snapshot.exists) return undefined;
  const data = asRecord(snapshot.data());
  const expected = expectedFrom(data);
  return {
    ...expected,
    status: requiredString(data.status, "JOB_STATUS_INVALID") as MonitoredJobRun["status"],
    ...(typeof data.startedAt === "string" ? { startedAt: data.startedAt } : {}),
    ...(typeof data.lastHeartbeatAt === "string"
      ? { lastHeartbeatAt: data.lastHeartbeatAt }
      : {}),
    ...(typeof data.heartbeatDeadlineAt === "string"
      ? { heartbeatDeadlineAt: data.heartbeatDeadlineAt }
      : {}),
    ...(typeof data.lease === "object" && data.lease !== null
      ? { lease: data.lease as MonitoredJobRun["lease"] }
      : {}),
    ...(typeof data.checkpoint === "string" ? { checkpoint: data.checkpoint } : {}),
    completedTargetReceipts: Array.isArray(data.completedTargetReceipts)
      ? (data.completedTargetReceipts as string[])
      : [],
  };
}

function activeLeaseToken(data: Record<string, unknown>): string | undefined {
  if (typeof data.lease !== "object" || data.lease === null) return undefined;
  const token = (data.lease as Record<string, unknown>).token;
  return typeof token === "string" ? token : undefined;
}

function leaseExpired(data: Record<string, unknown>, now: string): boolean {
  if (typeof data.lease !== "object" || data.lease === null) return true;
  const expiresAt = (data.lease as Record<string, unknown>).expiresAt;
  return typeof expiresAt !== "string" || Date.parse(expiresAt) <= Date.parse(now);
}

export class FirebaseScheduledJobExecutionRepository
  implements ScheduledJobRunRepositoryPort
{
  private readonly runs: firestore.CollectionReference;
  private readonly results: firestore.CollectionReference;

  constructor(
    database: firestore.Firestore,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly heartbeatTimeoutSeconds = 300,
  ) {
    if (
      !Number.isSafeInteger(heartbeatTimeoutSeconds) ||
      heartbeatTimeoutSeconds <= 0
    ) {
      throw new Error("HEARTBEAT_TIMEOUT_INVALID");
    }
    this.runs = operationsCollection(database, "scheduledJobRuns");
    this.results = operationsCollection(database, "scheduledJobResults");
  }

  async findByExecutionKey(executionKey: string): Promise<JobRun | undefined> {
    const snapshot = await this.runs
      .where("executionKey", "==", executionKey)
      .limit(2)
      .get();
    if (snapshot.size > 1) throw new Error("SCHEDULED_JOB_EXECUTION_KEY_CONFLICT");
    return snapshot.empty ? undefined : toExecutionRun(snapshot.docs[0]);
  }

  async getRun(runId: string): Promise<JobRun | undefined> {
    return toExecutionRun(await this.runs.doc(runId).get());
  }

  async saveRun(run: JobRun): Promise<void> {
    const reference = this.runs.doc(run.runId);
    await reference.firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(reference);
      if (current.exists) {
        const currentData = asRecord(current.data());
        const currentToken = activeLeaseToken(currentData);
        const incomingToken = run.lease?.token;
        const terminalIncoming =
          run.status === "COMPLETE" ||
          run.status === "PARTIAL_FAILURE" ||
          run.status === "FAILED";
        if (
          !terminalIncoming &&
          currentToken !== undefined &&
          currentToken !== incomingToken &&
          !leaseExpired(currentData, this.now())
        ) {
          throw new Error("SCHEDULED_JOB_RUN_ALREADY_CLAIMED");
        }
      }
      const currentStatus = current.exists
        ? asRecord(current.data()).status
        : undefined;
      const currentData = current.exists ? asRecord(current.data()) : undefined;
      const terminalAt =
        typeof currentData?.terminalAt === "string"
          ? currentData.terminalAt
          : this.now();
      transaction.set(
        reference,
        {
          runId: run.runId,
          jobName: run.jobName,
          executionKey: run.executionKey,
          status: run.status,
          ...(run.checkpoint === undefined
            ? {}
            : { checkpoint: run.checkpoint }),
          ...(run.lease === undefined
            ? { lease: FieldValue.delete() }
            : { lease: run.lease }),
          ...(run.lastHeartbeatAt === undefined
            ? {}
            : { lastHeartbeatAt: run.lastHeartbeatAt }),
          targets: run.targets,
          totals: run.totals,
          completedTargetReceipts: run.targets
            .filter(({ kind }) => kind === "SUCCEEDED" || kind === "SKIPPED")
            .map(({ targetIdHash }) => targetIdHash),
          ...(run.status === "RUNNING" &&
          (!current.exists || currentStatus === "EXPECTED" || currentStatus === "MISSING")
            ? { startedAt: this.now() }
            : {}),
          ...(run.lastHeartbeatAt === undefined
            ? {}
            : {
                heartbeatDeadlineAt: plusSeconds(
                  run.lastHeartbeatAt,
                  this.heartbeatTimeoutSeconds,
                ),
              }),
          ...(run.status === "COMPLETE"
            ? {
                terminalAt,
                expiresAt: firestoreTtlAfter(terminalAt),
              }
            : {
                terminalAt: FieldValue.delete(),
                expiresAt: FieldValue.delete(),
              }),
          updatedAt: FieldValue.serverTimestamp(),
          ...(current.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
        },
        { merge: true },
      );
    });
  }

  async getResult(runId: string): Promise<JobExecutionResult | undefined> {
    return toExecutionResult(await this.results.doc(runId).get());
  }

  async saveResult(result: JobExecutionResult): Promise<void> {
    await this.results.doc(result.runId).set({
      runId: result.runId,
      jobName: result.jobName,
      status: result.status,
      ...(result.checkpoint === undefined
        ? {}
        : { checkpoint: result.checkpoint }),
      totals: result.totals,
      failures: result.failures,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      ...(result.status === "COMPLETE"
        ? {
            terminalAt: result.finishedAt,
            expiresAt: firestoreTtlAfter(result.finishedAt),
          }
        : {}),
      schemaVersion: 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

export class FirebaseScheduledJobExpectationWriter {
  private readonly runs: firestore.CollectionReference;

  constructor(private readonly database: firestore.Firestore) {
    this.runs = operationsCollection(database, "scheduledJobRuns");
  }

  async ensure(input: {
    readonly occurrenceId: string;
    readonly definition: ScheduledJobDefinition;
    readonly scheduledFor: string;
    readonly executionKeyHash: string;
  }): Promise<void> {
    const reference = this.runs.doc(input.occurrenceId);
    await this.database.runTransaction(async (transaction) => {
      const current = await transaction.get(reference);
      if (current.exists) return;
      transaction.create(reference, {
        schemaVersion: 1,
        occurrenceId: input.occurrenceId,
        runId: input.occurrenceId,
        jobName: input.definition.jobName,
        scheduledFor: input.scheduledFor,
        startGraceDeadlineAt: plusSeconds(
          input.scheduledFor,
          input.definition.startGraceSeconds,
        ),
        executionDeadlineAt: plusSeconds(
          input.scheduledFor,
          input.definition.executionDeadlineSeconds,
        ),
        executionKeyHash: input.executionKeyHash,
        status: "EXPECTED",
        completedTargetReceipts: [],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }
}

export class FirebaseScheduledJobMonitorRepository
  implements ScheduledJobMonitorRepositoryPort
{
  private readonly runs: firestore.CollectionReference;
  private readonly incidents: firestore.CollectionReference;
  private readonly receipts: firestore.CollectionReference;

  constructor(
    database: firestore.Firestore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.runs = operationsCollection(database, "scheduledJobRuns");
    this.incidents = operationsCollection(database, "scheduledJobIncidents");
    this.receipts = operationsCollection(database, "scheduledJobMonitorReceipts");
  }

  async listExpectedOccurrences(): Promise<readonly ExpectedScheduledOccurrence[]> {
    const cutoff = new Date(Date.parse(this.now()) - 48 * 60 * 60 * 1_000).toISOString();
    const snapshot = await this.runs
      .where("scheduledFor", ">=", cutoff)
      .orderBy("scheduledFor", "asc")
      .get();
    return snapshot.docs.map((document) => expectedFrom(asRecord(document.data())));
  }

  async getRun(occurrenceId: string): Promise<MonitoredJobRun | undefined> {
    return toMonitoredRun(await this.runs.doc(occurrenceId).get());
  }

  async saveRun(run: MonitoredJobRun): Promise<void> {
    const terminalAt = this.now();
    await this.runs.doc(run.occurrenceId).set(
      {
        occurrenceId: run.occurrenceId,
        jobName: run.jobName,
        scheduledFor: run.scheduledFor,
        startGraceDeadlineAt: run.startGraceDeadlineAt,
        executionDeadlineAt: run.executionDeadlineAt,
        status: run.status,
        ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
        ...(run.lastHeartbeatAt === undefined
          ? {}
          : { lastHeartbeatAt: run.lastHeartbeatAt }),
        ...(run.heartbeatDeadlineAt === undefined
          ? { heartbeatDeadlineAt: FieldValue.delete() }
          : { heartbeatDeadlineAt: run.heartbeatDeadlineAt }),
        ...(run.lease === undefined
          ? { lease: FieldValue.delete() }
          : { lease: run.lease }),
        ...(run.checkpoint === undefined
          ? {}
          : { checkpoint: run.checkpoint }),
        completedTargetReceipts: run.completedTargetReceipts,
        ...(run.status === "COMPLETE"
          ? {
              terminalAt,
              expiresAt: firestoreTtlAfter(terminalAt),
            }
          : {
              terminalAt: FieldValue.delete(),
              expiresAt: FieldValue.delete(),
            }),
        schemaVersion: 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  async getIncident(occurrenceId: string): Promise<JobIncident | undefined> {
    const snapshot = await this.incidents.doc(occurrenceId).get();
    return snapshot.exists ? (snapshot.data() as JobIncident) : undefined;
  }

  async saveIncident(incident: JobIncident): Promise<void> {
    const reference = this.incidents.doc(incident.occurrenceId);
    const previous = await reference.get();
    await reference.set(
      {
        ...incident,
        ...(incident.state === "RESOLVED" && incident.resolvedAt !== undefined
          ? {
              terminalAt: incident.resolvedAt,
              expiresAt: firestoreTtlAfter(incident.resolvedAt),
            }
          : {
              terminalAt: FieldValue.delete(),
              expiresAt: FieldValue.delete(),
            }),
        schemaVersion: 1,
        updatedAt: FieldValue.serverTimestamp(),
        ...(previous.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    );
    const log = {
      severity: incident.state === "OPEN" ? "ERROR" : "INFO",
      eventType:
        incident.state === "OPEN"
          ? "SCHEDULED_JOB_INCIDENT_OPENED"
          : "SCHEDULED_JOB_INCIDENT_RESOLVED",
      incidentId: incident.incidentId,
      occurrenceId: incident.occurrenceId,
      reason: incident.reason,
      observedAt: incident.resolvedAt ?? incident.openedAt,
    };
    if (incident.state === "OPEN") {
      logger.error("scheduled-job-incident", log);
    } else {
      logger.info("scheduled-job-incident-resolved", log);
    }
  }

  async getMonitorReceipt(
    monitorOccurrenceId: string,
  ): Promise<JobMonitorResult | undefined> {
    const snapshot = await this.receipts.doc(monitorOccurrenceId).get();
    return snapshot.exists ? (snapshot.data() as JobMonitorResult) : undefined;
  }

  async saveMonitorReceipt(result: JobMonitorResult): Promise<void> {
    const terminalAt = this.now();
    await this.receipts.doc(result.monitorOccurrenceId).set({
      ...result,
      terminalAt,
      expiresAt: firestoreTtlAfter(terminalAt),
      schemaVersion: 1,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
}

export class Sha256ScheduledJobIdentity
  implements JobExecutionIdentityPort, JobIncidentIdentityPort
{
  runId(command: RunScheduledJobCommand): string {
    return `${command.jobName}:${this.hash(command.executionKey).slice(0, 40)}`;
  }

  leaseToken(runId: string, attempt: number): string {
    return this.hash(`${runId}:${attempt}:${randomUUID()}`);
  }

  hash(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
  }

  forOccurrence(occurrenceId: string): string {
    return `scheduled-job:${this.hash(occurrenceId).slice(0, 40)}`;
  }
}

export class SystemScheduledJobClock implements JobExecutionClockPort {
  now(): string {
    return new Date().toISOString();
  }
}

export class StructuredJobExecutionObservation
  implements JobExecutionObservationPort
{
  record(input: Parameters<JobExecutionObservationPort["record"]>[0]): void {
    const observation = {
      eventType: "SCHEDULED_JOB_OUTCOME",
      ...input,
    };
    if (input.status === "COMPLETE") {
      logger.info("scheduled-job-outcome", observation);
    } else {
      logger.error("scheduled-job-outcome", observation);
    }
  }
}

export class NoInjectedTopLevelJobFailure implements TopLevelJobFailurePort {
  failure(): undefined {
    return undefined;
  }
}

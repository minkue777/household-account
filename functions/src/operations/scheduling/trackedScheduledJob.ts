import { createScheduledJobExecutionApplication } from "../../platform/external-operations/application/scheduledJobExecutionApplication";
import type { JobExecutionResult } from "../../platform/external-operations/application/ports/in/scheduledJobExecutionInputPort";
import type { ScheduledFeaturePagePort } from "../../platform/external-operations/application/ports/out/scheduledJobExecutionPorts";
import {
  FirebaseScheduledJobExecutionRepository,
  FirebaseScheduledJobExpectationWriter,
  NoInjectedTopLevelJobFailure,
  Sha256ScheduledJobIdentity,
  StructuredJobExecutionObservation,
  SystemScheduledJobClock,
} from "../../adapters/firebase/operations/firebaseScheduledJobStores";
import type * as firestore from "firebase-admin/firestore";

import {
  scheduledJobDefinition,
  type ScheduledJobDefinitionSet,
  type ScheduledJobName,
} from "./scheduledJobDefinitions";
import { occurrenceFor } from "./scheduledOccurrence";

export interface TrackedScheduledJobRequest {
  readonly jobName: ScheduledJobName;
  readonly scheduledFor: string;
  readonly workerId: string;
  readonly pages: ScheduledFeaturePagePort;
}

function plusSeconds(value: string, seconds: number): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("SCHEDULE_TIME_INVALID");
  return new Date(parsed + seconds * 1_000).toISOString();
}

export async function runTrackedScheduledJob(input: {
  readonly database: firestore.Firestore;
  readonly request: TrackedScheduledJobRequest;
  readonly definitions?: ScheduledJobDefinitionSet;
}): Promise<JobExecutionResult> {
  const definition = scheduledJobDefinition(
    input.request.jobName,
    input.definitions,
  );
  const occurrence = occurrenceFor(
    input.request.jobName,
    input.request.scheduledFor,
  );
  const identity = new Sha256ScheduledJobIdentity();
  const command = {
    jobName: occurrence.jobName,
    executionKey: occurrence.executionKey,
    workerId: input.request.workerId,
    scheduledFor: occurrence.scheduledFor,
    // Start grace is monitored separately. A delayed but accepted invocation still
    // receives its own bounded processing budget and resumes from the checkpoint.
    deadlineAt: plusSeconds(
      new Date().toISOString(),
      definition.executionDeadlineSeconds,
    ),
  };
  const occurrenceId = identity.runId(command);
  await new FirebaseScheduledJobExpectationWriter(input.database).ensure({
    occurrenceId,
    definition,
    scheduledFor: occurrence.scheduledFor,
    executionKeyHash: identity.hash(occurrence.executionKey),
  });

  return createScheduledJobExecutionApplication({
    pages: input.request.pages,
    repository: new FirebaseScheduledJobExecutionRepository(
      input.database,
      undefined,
      definition.heartbeatTimeoutSeconds,
    ),
    observations: new StructuredJobExecutionObservation(),
    identity,
    clock: new SystemScheduledJobClock(),
    topLevelFailure: new NoInjectedTopLevelJobFailure(),
    leaseDurationMs: definition.leaseDurationSeconds * 1_000,
    maxPagesPerExecution: definition.maxPagesPerOccurrence,
  }).run(command);
}

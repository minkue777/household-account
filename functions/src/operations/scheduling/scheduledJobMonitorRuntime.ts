import type * as firestore from "firebase-admin/firestore";

import {
  FirebaseScheduledJobExpectationWriter,
  FirebaseScheduledJobMonitorRepository,
  Sha256ScheduledJobIdentity,
} from "../../adapters/firebase/operations/firebaseScheduledJobStores";
import { createScheduledJobMonitorApplication } from "../../platform/external-operations/application/scheduledJobMonitorApplication";
import type { JobMonitorResult } from "../../platform/external-operations/application/ports/in/scheduledJobMonitorInputPort";
import {
  loadScheduledJobDefinitions,
  scheduledJobDefinition,
  type ScheduledJobDefinitionSet,
} from "./scheduledJobDefinitions";
import {
  expectedBusinessOccurrences,
  occurrenceFor,
} from "./scheduledOccurrence";

export async function runScheduledJobMonitor(input: {
  readonly database: firestore.Firestore;
  readonly scheduledFor: string;
  readonly observedAt?: string;
  readonly definitions?: ScheduledJobDefinitionSet;
}): Promise<JobMonitorResult> {
  const definitions = input.definitions ?? loadScheduledJobDefinitions();
  const observedAt = input.observedAt ?? new Date().toISOString();
  const identity = new Sha256ScheduledJobIdentity();
  const expectationWriter = new FirebaseScheduledJobExpectationWriter(
    input.database,
  );

  for (const occurrence of expectedBusinessOccurrences({
    observedAt,
    lookbackHours: 48,
    definitions,
  })) {
    const definition = scheduledJobDefinition(occurrence.jobName, definitions);
    const command = {
      jobName: occurrence.jobName,
      executionKey: occurrence.executionKey,
      workerId: "expectation-materializer",
      scheduledFor: occurrence.scheduledFor,
      deadlineAt: new Date(
        Date.parse(occurrence.scheduledFor) +
          definition.executionDeadlineSeconds * 1_000,
      ).toISOString(),
    };
    await expectationWriter.ensure({
      occurrenceId: identity.runId(command),
      definition,
      scheduledFor: occurrence.scheduledFor,
      executionKeyHash: identity.hash(occurrence.executionKey),
    });
  }

  const monitorOccurrence = occurrenceFor(
    "scheduled-job-monitor",
    input.scheduledFor,
  );
  const monitorOccurrenceId = identity.runId({
    jobName: monitorOccurrence.jobName,
    executionKey: monitorOccurrence.executionKey,
    workerId: "scheduled-job-monitor",
    scheduledFor: monitorOccurrence.scheduledFor,
    deadlineAt: monitorOccurrence.scheduledFor,
  });
  const application = createScheduledJobMonitorApplication({
    repository: new FirebaseScheduledJobMonitorRepository(input.database),
    incidentIds: identity,
  });
  return application.detectMissingOrOverdueRuns({
    monitorOccurrenceId,
    observedAt,
  });
}

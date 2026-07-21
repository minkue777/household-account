import { createScheduledJobMonitorApplication } from "../../src/platform/external-operations/application/scheduledJobMonitorApplication";
import type {
  ExpectedScheduledOccurrence,
  JobIncident,
  JobMonitorResult,
  MonitoredJobRun,
} from "../../src/platform/external-operations/public";

export function createScheduledJobMonitorFixture(fixture: {
  readonly expectedOccurrences: readonly ExpectedScheduledOccurrence[];
  readonly runs?: readonly MonitoredJobRun[];
  readonly incidents?: readonly JobIncident[];
}) {
  const expected = fixture.expectedOccurrences.map((entry) => ({ ...entry }));
  const runs = new Map(
    (fixture.runs ?? []).map((run) => [run.occurrenceId, { ...run }] as const),
  );
  const incidents = new Map(
    (fixture.incidents ?? []).map((incident) => [
      incident.occurrenceId,
      { ...incident },
    ] as const),
  );
  const receipts = new Map<string, JobMonitorResult>();

  const application = createScheduledJobMonitorApplication({
    repository: {
      async listExpectedOccurrences() {
        return expected.map((entry) => ({ ...entry }));
      },
      async getRun(occurrenceId) {
        const run = runs.get(occurrenceId);
        return run === undefined ? undefined : { ...run };
      },
      async saveRun(run) {
        runs.set(run.occurrenceId, { ...run });
      },
      async getIncident(occurrenceId) {
        const incident = incidents.get(occurrenceId);
        return incident === undefined ? undefined : { ...incident };
      },
      async saveIncident(incident) {
        incidents.set(incident.occurrenceId, { ...incident });
      },
      async getMonitorReceipt(monitorOccurrenceId) {
        return receipts.get(monitorOccurrenceId);
      },
      async saveMonitorReceipt(result) {
        receipts.set(result.monitorOccurrenceId, result);
      },
    },
    incidentIds: {
      forOccurrence: (occurrenceId) => `incident:${occurrenceId}`,
    },
  });

  return {
    ...application,
    monitorReceipts: () =>
      [...receipts.values()].map(({ monitorOccurrenceId, inspectedOccurrenceIds }) => ({
        monitorOccurrenceId,
        inspectedOccurrenceIds: [...inspectedOccurrenceIds],
      })),
  };
}

import type {
  JobIncident,
  JobMonitorResult,
  MonitoredJobRun,
  MonitoredJobStatus,
  ScheduledJobMonitorInputPort,
} from "./ports/in/scheduledJobMonitorInputPort";
import type {
  JobIncidentIdentityPort,
  ScheduledJobMonitorRepositoryPort,
} from "./ports/out/scheduledJobMonitorRepositoryPort";

const TERMINAL = new Set<MonitoredJobStatus>([
  "COMPLETE",
  "PARTIAL_FAILURE",
  "FAILED",
]);

function after(observedAt: string, deadlineAt: string): boolean {
  return Date.parse(observedAt) > Date.parse(deadlineAt);
}

export function createScheduledJobMonitorApplication(dependencies: {
  readonly repository: ScheduledJobMonitorRepositoryPort;
  readonly incidentIds: JobIncidentIdentityPort;
}): ScheduledJobMonitorInputPort {
  return {
    async detectMissingOrOverdueRuns(input) {
      const replay = await dependencies.repository.getMonitorReceipt(
        input.monitorOccurrenceId,
      );
      if (replay !== undefined) return replay;

      const expectedOccurrences = await dependencies.repository.listExpectedOccurrences();
      const transitions: JobMonitorResult["transitions"][number][] = [];
      const openedIncidentIds: string[] = [];
      const resolvedIncidentIds: string[] = [];

      for (const expected of expectedOccurrences) {
        let run = await dependencies.repository.getRun(expected.occurrenceId);
        const incident = await dependencies.repository.getIncident(expected.occurrenceId);

        if (run !== undefined && TERMINAL.has(run.status)) {
          if (incident?.state === "OPEN") {
            const resolved: JobIncident = {
              ...incident,
              state: "RESOLVED",
              resolvedAt: input.observedAt,
              alertResolveCount: incident.alertResolveCount + 1,
            };
            await dependencies.repository.saveIncident(resolved);
            resolvedIncidentIds.push(resolved.incidentId);
          }
          continue;
        }

        let reason: JobIncident["reason"] | undefined;
        let from: MonitoredJobStatus | undefined;
        if (run === undefined) {
          if (after(input.observedAt, expected.startGraceDeadlineAt)) {
            from = "EXPECTED";
            reason = "MISSING";
            run = {
              ...expected,
              status: "MISSING",
              completedTargetReceipts: [],
            };
          }
        } else if (run.status === "RUNNING") {
          if (after(input.observedAt, run.executionDeadlineAt)) {
            from = "RUNNING";
            reason = "DEADLINE_OVERDUE";
          } else if (
            run.heartbeatDeadlineAt !== undefined &&
            after(input.observedAt, run.heartbeatDeadlineAt)
          ) {
            from = "RUNNING";
            reason = "HEARTBEAT_OVERDUE";
          }
          if (reason !== undefined) run = { ...run, status: "OVERDUE" };
        }

        if (reason === undefined || run === undefined || from === undefined) continue;

        await dependencies.repository.saveRun(run);
        transitions.push({
          occurrenceId: expected.occurrenceId,
          from,
          to: run.status,
          reason,
        });
        if (incident === undefined) {
          const opened: JobIncident = {
            incidentId: dependencies.incidentIds.forOccurrence(expected.occurrenceId),
            occurrenceId: expected.occurrenceId,
            state: "OPEN",
            reason,
            openedAt: input.observedAt,
            alertOpenCount: 1,
            alertResolveCount: 0,
          };
          await dependencies.repository.saveIncident(opened);
          openedIncidentIds.push(opened.incidentId);
        }
      }

      const result: JobMonitorResult = {
        kind: "complete",
        monitorOccurrenceId: input.monitorOccurrenceId,
        inspectedOccurrenceIds: expectedOccurrences.map(({ occurrenceId }) => occurrenceId),
        transitions,
        openedIncidentIds,
        resolvedIncidentIds,
      };
      await dependencies.repository.saveMonitorReceipt(result);
      return result;
    },

    async recordRunRecovery(input) {
      const run = await dependencies.repository.getRun(input.occurrenceId);
      if (run === undefined) throw new Error("SCHEDULED_JOB_RUN_NOT_FOUND");
      const recovered: MonitoredJobRun = {
        ...run,
        status: input.terminalStatus,
        lease: undefined,
        heartbeatDeadlineAt: undefined,
      };
      await dependencies.repository.saveRun(recovered);
      return { kind: "success", run: recovered };
    },

    async getRun(occurrenceId) {
      const run = await dependencies.repository.getRun(occurrenceId);
      if (run === undefined) throw new Error("SCHEDULED_JOB_RUN_NOT_FOUND");
      return run;
    },
    getIncident: (occurrenceId) => dependencies.repository.getIncident(occurrenceId),
  };
}

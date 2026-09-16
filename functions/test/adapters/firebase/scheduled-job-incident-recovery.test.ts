import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { FirebaseScheduledJobExecutionRepository, FirebaseScheduledJobMonitorRepository, Sha256ScheduledJobIdentity } from "../../../src/adapters/firebase/operations/firebaseScheduledJobStores";
import { createScheduledJobMonitorApplication } from "../../../src/platform/external-operations/application/scheduledJobMonitorApplication";
import type { JobRun } from "../../../src/platform/external-operations/application/ports/in/scheduledJobExecutionInputPort";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

const now = "2026-09-16T00:00:05.000Z";
const base = "operations/runtime/";
const oldId = "asset-automation-daily:old";
function fixture() {
  const memory = new InMemoryFirestore();
  memory.seed(`${base}scheduledJobRuns/${oldId}`, {
    occurrenceId: oldId, runId: oldId, jobName: "asset-automation-daily", status: "MISSING",
    scheduledFor: "2026-09-09T15:00:00Z", startGraceDeadlineAt: "2026-09-09T15:30:00Z",
    executionDeadlineAt: "2026-09-09T16:00:00Z", completedTargetReceipts: [],
  });
  const incident = { occurrenceId: oldId, incidentId: "old-alarm", reason: "MISSING",
    state: "OPEN", openedAt: "2026-09-09T16:00:07Z", alertOpenCount: 1, alertResolveCount: 0 };
  memory.seed(`${base}scheduledJobIncidents/${oldId}`, incident);
  const database = memory as unknown as firestore.Firestore;
  const execution = new FirebaseScheduledJobExecutionRepository(database, () => now);
  const monitor = new FirebaseScheduledJobMonitorRepository(database, () => now);
  return { memory, execution, monitor, incident };
}
async function complete(f: ReturnType<typeof fixture>, jobName: string, status: "COMPLETE" | "PARTIAL_FAILURE" = "COMPLETE") {
  const run: JobRun = { runId: `${jobName}:new`, jobName, executionKey: `${jobName}:today`,
    status: "RUNNING", attempt: 1, lease: { token: "owner", ownerId: "owner", attempt: 1, expiresAt: "2026-09-16T00:10:00Z" },
    targets: [], totals: { target: 0, succeeded: 0, skipped: 0, failed: 0 } };
  f.memory.seed(`${base}scheduledJobRuns/${run.runId}`, { occurrenceId: run.runId, jobName,
    scheduledFor: "2026-09-16T00:00:00Z", startGraceDeadlineAt: now, executionDeadlineAt: now, status: "EXPECTED" });
  await f.execution.saveRun(run);
  await f.execution.completeRun({ ...run, status, lease: undefined }, { runId: run.runId, jobName,
    status, totals: run.totals, failures: [], startedAt: now, finishedAt: now }, "owner");
}

describe("scheduled incident recovery", () => {
  it("[JOB-ERR-002] next successful run closes a six-day-old alarm in the completion transaction without rewriting its failed run", async () => {
    const f = fixture();
    await complete(f, "asset-automation-daily");
    expect(f.memory.document(`${base}scheduledJobIncidents/${oldId}`)).toMatchObject({
      state: "RESOLVED", resolvedAt: now, alertResolveCount: 1, recoveryOccurrenceId: "asset-automation-daily:new",
    });
    expect(f.memory.document(`${base}scheduledJobRuns/${oldId}`)?.status).toBe("MISSING");
    // A delayed monitor must not resurrect an already resolved incident.
    await f.monitor.saveIncident(f.incident as Parameters<typeof f.monitor.saveIncident>[0]);
    expect((await f.monitor.getIncident(oldId))?.state).toBe("RESOLVED");
    expect((await f.monitor.getIncident(oldId))?.alertResolveCount).toBe(1);
  });
  it.each([['other-job', 'COMPLETE'], ['asset-automation-daily', 'PARTIAL_FAILURE']] as const)("%s / %s does not claim recovery", async (job, status) => {
    const f = fixture(); await complete(f, job, status);
    expect((await f.monitor.getIncident(oldId))?.state).toBe("OPEN");
  });
  it("[JOB-ERR-002] monitor revisits alarms outside its 48-hour window and reconciles a pre-existing later success", async () => {
    const f = fixture();
    f.memory.seed(`${base}scheduledJobRuns/asset-automation-daily:latest`, { occurrenceId: "asset-automation-daily:latest",
      jobName: "asset-automation-daily", status: "COMPLETE", scheduledFor: "2026-09-16T00:00:00Z",
      startGraceDeadlineAt: now, executionDeadlineAt: now, completedTargetReceipts: [] });
    const app = createScheduledJobMonitorApplication({ repository: f.monitor, incidentIds: new Sha256ScheduledJobIdentity() });
    const result = await app.detectMissingOrOverdueRuns({ monitorOccurrenceId: "monitor:new", observedAt: now });
    expect(result.inspectedOccurrenceIds).toContain(oldId);
    expect(result.resolvedIncidentIds).toEqual(["old-alarm"]);
    expect((await f.monitor.getIncident(oldId))?.state).toBe("RESOLVED");
    expect((await app.detectMissingOrOverdueRuns({ monitorOccurrenceId: "monitor:again", observedAt: now })).resolvedIncidentIds).toEqual([]);
  });
});

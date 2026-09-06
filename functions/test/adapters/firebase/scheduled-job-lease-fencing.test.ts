import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { FirebaseScheduledJobExecutionRepository, FirebaseScheduledJobMonitorRepository } from "../../../src/adapters/firebase/operations/firebaseScheduledJobStores";
import type { JobRun } from "../../../src/platform/external-operations/application/ports/in/scheduledJobExecutionInputPort";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

const now = "2026-09-06T00:00:00.000Z";
function run(token: string, attempt: number, expiresAt = "2026-09-06T00:05:00.000Z"): JobRun {
  return { runId: "occurrence", jobName: "daily", executionKey: "daily:today",
    status: "RUNNING", checkpoint: `page:${attempt}`, attempt,
    lease: { ownerId: token, token, attempt, expiresAt },
    targets: [], totals: { target: 0, succeeded: 0, skipped: 0, failed: 0 } };
}
function completion(active: JobRun) {
  const final = { ...active, status: "COMPLETE" as const, lease: undefined };
  const result = { runId: active.runId, jobName: active.jobName,
    status: "COMPLETE" as const, totals: active.totals, failures: [],
    startedAt: now, finishedAt: now };
  return { final, result };
}
describe("Firebase scheduled job lease fencing", () => {
  it("late monitor observations cannot overwrite a new heartbeat or terminal completion", async () => {
    const memory = new InMemoryFirestore();
    const database = memory as unknown as firestore.Firestore;
    const repository = new FirebaseScheduledJobExecutionRepository(database, () => now);
    const monitor = new FirebaseScheduledJobMonitorRepository(database, () => now);
    const expected = { occurrenceId: 'occurrence', jobName: 'daily', scheduledFor: now, startGraceDeadlineAt: now, executionDeadlineAt: now, completedTargetReceipts: [] };
    const old = run('old', 1, '2026-09-05T23:59:00Z'); await repository.saveRun(old);
    await repository.saveRun(run('new', 2));
    expect(await monitor.saveRun({ ...expected, status: 'OVERDUE', checkpoint: old.checkpoint, lease: old.lease })).toBe(false);
    const active = run('new', 2); const { final, result } = completion(active); await repository.completeRun(final, result, 'new');
    expect(await monitor.saveRun({ ...expected, status: 'MISSING' })).toBe(false);
    expect((await repository.getRun('occurrence'))?.status).toBe('COMPLETE');
  });
  it("rejects an old worker's completion and heartbeat after takeover without changing the new lease or result", async () => {
    const memory = new InMemoryFirestore();
    const repository = new FirebaseScheduledJobExecutionRepository(memory as unknown as firestore.Firestore, () => now);
    const old = run("old", 1, "2026-09-05T23:59:00.000Z");
    await repository.saveRun(old);
    const current = run("new", 2);
    await repository.saveRun(current);
    const { final, result } = completion(old);
    await expect(repository.completeRun(final, result, "old")).rejects.toThrow("SCHEDULED_JOB_STALE_LEASE");
    await expect(repository.saveRun(run("old", 1))).rejects.toThrow();
    expect((await repository.getRun("occurrence"))?.lease?.token).toBe("new");
    expect((await repository.getRun("occurrence"))?.checkpoint).toBe("page:2");
    expect(await repository.getResult("occurrence")).toBeUndefined();
  });
  it("commits the owner's terminal run and result together and rejects unfenced terminal writes", async () => {
    const memory = new InMemoryFirestore();
    const repository = new FirebaseScheduledJobExecutionRepository(memory as unknown as firestore.Firestore, () => now);
    const active = run("owner", 1);
    await repository.saveRun(active);
    const { final, result } = completion(active);
    await expect(repository.saveRun(final)).rejects.toThrow("SCHEDULED_JOB_COMPLETION_REQUIRED");
    expect((await repository.getRun("occurrence"))?.status).toBe("RUNNING");
    await repository.completeRun(final, result, "owner");
    expect((await repository.getRun("occurrence"))?.status).toBe("COMPLETE");
    expect((await repository.getResult("occurrence"))?.status).toBe("COMPLETE");
    await expect(repository.saveRun(run("late", 2))).rejects.toThrow();
  });
  it("rejects completion with an expired lease even before another worker claims it", async () => {
    const memory = new InMemoryFirestore();
    const repository = new FirebaseScheduledJobExecutionRepository(memory as unknown as firestore.Firestore, () => now);
    const expired = run("expired", 1, "2026-09-05T23:59:00.000Z");
    await repository.saveRun(expired);
    const { final, result } = completion(expired);
    await expect(repository.completeRun(final, result, "expired")).rejects.toThrow("SCHEDULED_JOB_STALE_LEASE");
    expect(await repository.getResult("occurrence")).toBeUndefined();
  });
});

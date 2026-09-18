import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirebaseScheduledJobExecutionRepository, FirebaseScheduledJobExpectationWriter } from '../../../src/adapters/firebase/operations/firebaseScheduledJobStores';
import { scheduledJobDefinition } from '../../../src/operations/scheduling/scheduledJobDefinitions';
import * as projection from '../../../src/adapters/firebase/operations/scheduledJobStatusSummary';
import type { JobRun } from '../../../src/platform/external-operations/application/ports/in/scheduledJobExecutionInputPort';
// @ts-expect-error 일회성 운영 ESM은 별도 declaration을 배포하지 않습니다.
import { backfillScheduledJobStatuses } from '../../../scripts/backfill-scheduled-job-statuses.mjs';

const projectId = 'demo-household-scheduled-job-status';
const jobName = 'asset-automation-daily';
const now = '2026-09-18T00:05:00.000Z';
const totals = { target: 1, succeeded: 1, skipped: 0, failed: 0 };
const suite = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let app: App;
let database: Firestore;
const operations = () => database.collection('operations').doc('runtime');
async function start(id: string, scheduledFor: string) {
  const runId = `${jobName}:${id}`;
  await new FirebaseScheduledJobExpectationWriter(database).ensure({ occurrenceId: runId, definition: scheduledJobDefinition(jobName), scheduledFor, executionKeyHash: id });
  const run: JobRun = { runId, jobName, executionKey: id, status: 'RUNNING', lastHeartbeatAt: now, targets: [], totals,
    lease: { token: id, ownerId: id, attempt: 1, expiresAt: '2026-09-18T00:15:00.000Z' } };
  await new FirebaseScheduledJobExecutionRepository(database, () => now).saveRun(run);
  return run;
}
const complete = (repository: FirebaseScheduledJobExecutionRepository, run: JobRun) => repository.completeRun(
  { ...run, status: 'COMPLETE', lease: undefined },
  { runId: run.runId, jobName, status: 'COMPLETE', totals, failures: [], startedAt: now, finishedAt: now }, run.lease!.token,
);

suite('Firebase scheduled job status summary', () => {
  beforeAll(() => { app = initializeApp({ projectId }, `job-status-${Date.now()}`); database = getFirestore(app); });
  beforeEach(async () => {
    const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
    if (!response.ok) throw new Error('EMULATOR_RESET_FAILED');
  });
  afterAll(async () => { if (app) await deleteApp(app); });

  it('동시 완료·초기화 경합에도 최신 예약이 유지되며 완료 이력 TTL을 보존한다', async () => {
    const older = await start('older', '2026-09-17T00:00:00.000Z');
    const latest = await start('latest', '2026-09-18T00:00:00.000Z');
    const repository = new FirebaseScheduledJobExecutionRepository(database, () => now);
    await Promise.all([
      complete(repository, older), complete(repository, latest),
      backfillScheduledJobStatuses(database, { definitions: [{ jobName }], projection, apply: true }),
    ]);
    const summary = (await operations().collection('scheduledJobStatuses').doc(jobName).get()).data();
    expect(summary).toMatchObject({ latestRun: { occurrenceId: latest.runId, status: 'COMPLETE', totals },
      latestSuccessfulRun: { occurrenceId: latest.runId, status: 'COMPLETE' } });
    expect(summary).not.toHaveProperty('expiresAt');
    for (const run of [older, latest]) {
      expect((await operations().collection('scheduledJobRuns').doc(run.runId).get()).get('expiresAt')).toBeInstanceOf(Timestamp);
      expect((await operations().collection('scheduledJobResults').doc(run.runId).get()).get('status')).toBe('COMPLETE');
    }
    expect(await backfillScheduledJobStatuses(database, { definitions: [{ jobName }], projection, apply: true })).toMatchObject({ changed: 0 });
  }, 30_000);

  it('commit 이전 실패는 실행·결과·요약 모두 원복하고 같은 lease의 재시도로 수렴한다', async () => {
    const run = await start('atomic', '2026-09-18T00:00:00.000Z');
    const reference = operations().collection('scheduledJobStatuses').doc(jobName);
    const before = (await reference.get()).data();
    const abortingDatabase = new Proxy(database, { get(target, property) {
      if (property === 'runTransaction') return (operation: Parameters<Firestore['runTransaction']>[0]) => target.runTransaction(async transaction => {
        await operation(transaction); throw new Error('TEST_BEFORE_COMMIT');
      });
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await expect(complete(new FirebaseScheduledJobExecutionRepository(abortingDatabase, () => now), run)).rejects.toThrow('TEST_BEFORE_COMMIT');
    expect((await reference.get()).data()).toEqual(before);
    expect((await operations().collection('scheduledJobRuns').doc(run.runId).get()).get('status')).toBe('RUNNING');
    expect((await operations().collection('scheduledJobResults').doc(run.runId).get()).exists).toBe(false);
    await complete(new FirebaseScheduledJobExecutionRepository(database, () => now), run);
    expect((await reference.get()).data()).toMatchObject({ latestRun: { status: 'COMPLETE' } });
  });
});

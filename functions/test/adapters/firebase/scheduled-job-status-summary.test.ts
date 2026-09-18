import type * as firestore from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import { FirebaseScheduledJobExecutionRepository, FirebaseScheduledJobExpectationWriter, FirebaseScheduledJobMonitorRepository } from '../../../src/adapters/firebase/operations/firebaseScheduledJobStores';
import * as projection from '../../../src/adapters/firebase/operations/scheduledJobStatusSummary';
import { FirebaseAdminDashboardReader } from '../../../src/adapters/firebase/admin/firebaseAdminDashboardReader';
import { scheduledJobDefinition } from '../../../src/operations/scheduling/scheduledJobDefinitions';
import type { JobRun } from '../../../src/platform/external-operations/application/ports/in/scheduledJobExecutionInputPort';
import { InMemoryFirestore } from '../../support/in-memory-firestore';
// @ts-expect-error 일회성 운영 ESM은 별도 declaration을 배포하지 않습니다.
import { backfillScheduledJobStatuses } from '../../../scripts/backfill-scheduled-job-statuses.mjs';

const base = 'operations/runtime/';
const jobName = 'asset-automation-daily';
const totals = { target: 3, succeeded: 2, skipped: 1, failed: 0 };
const today = '2026-09-18T00:00:00.000Z';
function fixture() {
  const memory = new InMemoryFirestore();
  const database = Object.assign(memory, { doc: (path: string) => { const parts = path.split('/'); return memory.collection(parts.slice(0, -1).join('/')).doc(parts.at(-1)!); } }) as unknown as firestore.Firestore;
  let now = '2026-09-18T00:00:01.000Z';
  const execution = new FirebaseScheduledJobExecutionRepository(database, () => now);
  const monitor = new FirebaseScheduledJobMonitorRepository(database, () => now);
  const expectations = new FirebaseScheduledJobExpectationWriter(database);
  const summary = () => memory.document(`${base}scheduledJobStatuses/${jobName}`);
  async function start(id: string, scheduledFor = today) {
    await expectations.ensure({ occurrenceId: `${jobName}:${id}`, definition: scheduledJobDefinition(jobName), scheduledFor, executionKeyHash: id });
    const run: JobRun = { runId: `${jobName}:${id}`, jobName, executionKey: id, status: 'RUNNING',
      lease: { token: id, ownerId: id, attempt: 1, expiresAt: '2026-09-18T00:30:00.000Z' }, lastHeartbeatAt: now, targets: [], totals };
    await execution.saveRun(run);
    return run;
  }
  async function complete(run: JobRun, status: 'COMPLETE' | 'FAILED' | 'PARTIAL_FAILURE' = 'COMPLETE') {
    await execution.completeRun({ ...run, status, lease: undefined }, { runId: run.runId, jobName, status,
      totals, failures: [], startedAt: today, finishedAt: now }, run.lease!.token);
  }
  const dashboard = () => new FirebaseAdminDashboardReader(database, { serviceName: 'test', revision: 'test', region: 'test' })
    .read({ generatedAt: now, rangeDays: 1 });
  return { memory, database, execution, monitor, expectations, summary, start, complete, dashboard, setNow: (value: string) => { now = value; } };
}

describe('예약 작업 최신 상태의 실제 writer/reader', () => {
  it('[JOB-ERR-002] EXPECTED·RUNNING·heartbeat·COMPLETE와 결과 요약을 함께 저장하고 이력 TTL은 유지한다', async () => {
    const f = fixture();
    await f.expectations.ensure({ occurrenceId: `${jobName}:today`, definition: scheduledJobDefinition(jobName), scheduledFor: today, executionKeyHash: 'today' });
    expect(f.summary()).toMatchObject({ latestRun: { status: 'EXPECTED', scheduledFor: today } });
    const run = await f.start('today');
    expect(f.summary()).toMatchObject({ latestRun: { status: 'RUNNING', totals } });
    f.setNow('2026-09-18T00:00:02.000Z');
    await f.execution.saveRun({ ...run, lastHeartbeatAt: '2026-09-18T00:00:02.000Z' });
    expect(f.summary()).toMatchObject({ latestRun: { lastUpdatedAt: '2026-09-18T00:00:02.000Z' } });
    await f.complete(run);
    expect(f.summary()).toMatchObject({ latestRun: { status: 'COMPLETE' }, latestSuccessfulRun: { occurrenceId: run.runId } });
    expect(f.summary()).not.toHaveProperty('expiresAt');
    expect(JSON.stringify(f.summary())).not.toMatch(/lease|targets|executionKey|checkpoint/);
    expect(f.memory.document(`${base}scheduledJobRuns/${run.runId}`)).toHaveProperty('expiresAt');
    expect(f.memory.document(`${base}scheduledJobResults/${run.runId}`)).toHaveProperty('expiresAt');
  });

  it('[JOB-ERR-002] 늦게 끝난 이전 실행과 오래된 모니터가 최신 실행·성공 상태를 되돌리지 않는다', async () => {
    const f = fixture();
    const older = await f.start('old', '2026-09-17T00:00:00.000Z');
    const current = await f.start('today');
    await f.complete(current);
    const newer = await f.start('next', '2026-09-18T00:01:00.000Z');
    await f.complete(newer, 'FAILED');
    f.setNow('2026-09-18T00:02:00.000Z');
    await f.complete(older);
    const before = f.summary();
    expect(before).toMatchObject({ latestRun: { occurrenceId: newer.runId, status: 'FAILED' }, latestSuccessfulRun: { occurrenceId: current.runId } });
    expect(await f.monitor.saveRun({ occurrenceId: current.runId, jobName, scheduledFor: today,
      startGraceDeadlineAt: today, executionDeadlineAt: today, status: 'MISSING', completedTargetReceipts: [] })).toBe(false);
    expect(f.summary()).toEqual(before);
    await expect(f.execution.completeRun({ ...current, status: 'COMPLETE', lease: undefined }, {
      runId: current.runId, jobName, status: 'COMPLETE', totals, failures: [], startedAt: today, finishedAt: today,
    }, 'wrong-owner')).rejects.toThrow('SCHEDULED_JOB_STALE_LEASE');
    expect(f.summary()).toEqual(before);
  });

  it('[JOB-ERR-002] monitor의 누락·지연 상태와 monitor 자체 완료도 최신 요약에 반영한다', async () => {
    const f = fixture();
    const occurrenceId = `${jobName}:missing`;
    await f.expectations.ensure({ occurrenceId, definition: scheduledJobDefinition(jobName), scheduledFor: today, executionKeyHash: 'missing' });
    expect(await f.monitor.saveRun({ occurrenceId, jobName, scheduledFor: today, startGraceDeadlineAt: today,
      executionDeadlineAt: today, status: 'MISSING', completedTargetReceipts: [] })).toBe(true);
    expect(f.summary()).toMatchObject({ latestRun: { status: 'MISSING' } });
    const run = await f.start('running', '2026-09-18T00:01:00.000Z');
    expect(await f.monitor.saveRun({ occurrenceId: run.runId, jobName, scheduledFor: '2026-09-18T00:01:00.000Z',
      startGraceDeadlineAt: today, executionDeadlineAt: today, status: 'OVERDUE', lease: run.lease, lastHeartbeatAt: run.lastHeartbeatAt, completedTargetReceipts: [] })).toBe(true);
    expect(f.summary()).toMatchObject({ latestRun: { status: 'OVERDUE' } });
    await f.monitor.saveMonitorReceipt({ kind: 'complete', monitorOccurrenceId: 'monitor:one',
      inspectedOccurrenceIds: [], transitions: [], openedIncidentIds: [], resolvedIncidentIds: [] });
    expect(f.memory.document(`${base}scheduledJobStatuses/scheduled-job-monitor`)).toMatchObject({ latestRun: { status: 'COMPLETE' } });
    expect(f.memory.document(`${base}scheduledJobMonitorReceipts/monitor:one`)).toHaveProperty('expiresAt');
  });

  it('대시보드는 120개 이상 이력 대신 작업별 상태를 읽으며 후속 실패가 있어도 이전 정상복구를 잊지 않는다', async () => {
    const f = fixture();
    const oldId = `${jobName}:old-incident`;
    const success = await f.start('success'); await f.complete(success);
    const failure = await f.start('failed', '2026-09-18T00:01:00.000Z'); await f.complete(failure, 'FAILED');
    f.memory.seed(`${base}scheduledJobIncidents/old`, { incidentId: 'old', occurrenceId: oldId, state: 'OPEN', reason: 'MISSING', openedAt: '2026-09-17T01:00:00Z' });
    for (let i = 0; i < 140; i++) f.memory.seed(`${base}scheduledJobRuns/unrelated-${i}`, { jobName: 'other-job', scheduledFor: '2026-09-19T00:00:00Z', status: 'COMPLETE' });
    const scan = vi.spyOn(f.memory, 'documentsInCollection');
    const result = await f.dashboard();
    expect(result.scheduledJobs.find(job => job.jobName === jobName)?.latestStatus).toBe('FAILED');
    expect(result.incidents).toEqual([]);
    expect(scan.mock.calls.map(([path]) => path)).toContain(`${base}scheduledJobStatuses`);
    expect(scan.mock.calls.map(([path]) => path)).not.toContain(`${base}scheduledJobRuns`);
    expect(scan.mock.calls.map(([path]) => path)).not.toContain(`${base}scheduledJobMonitorReceipts`);
  });

  it('열린 장애의 해당 실행 종료는 단건 확인하고 다른 작업·미완료 장애는 유지한다', async () => {
    const f = fixture();
    const active = await f.start('active');
    for (const [id, status] of [['terminated', 'PARTIAL_FAILURE'], ['pending', 'RUNNING']] as const) {
      const occurrenceId = `${jobName}:${id}`;
      f.memory.seed(`${base}scheduledJobRuns/${occurrenceId}`, { occurrenceId, jobName, status, scheduledFor: '2026-09-17T00:00:00Z' });
      f.memory.seed(`${base}scheduledJobIncidents/${id}`, { incidentId: id, occurrenceId, state: 'OPEN', reason: 'HEARTBEAT_OVERDUE', openedAt: today });
    }
    const result = await f.dashboard();
    expect(result.scheduledJobs.find(job => job.jobName === jobName)?.latestStatus).toBe('RUNNING');
    expect(result.incidents.map(incident => incident.incidentId)).toEqual(['pending']);
    expect(f.memory.document(`${base}scheduledJobRuns/${active.runId}`)?.status).toBe('RUNNING');
  });

  it('운영 초기화는 실제 reducer로 과거 최신/성공을 만들고 재실행·더 최신 live 요약을 보존한다', async () => {
    const f = fixture();
    f.memory.seed(`${base}scheduledJobRuns/${jobName}:old`, { jobName, status: 'COMPLETE', scheduledFor: '2026-09-17T00:00:00Z' });
    f.memory.seed(`${base}scheduledJobRuns/${jobName}:failed`, { jobName, status: 'FAILED', scheduledFor: today });
    const options = { definitions: [{ jobName }], projection };
    expect(await backfillScheduledJobStatuses(f.database, options)).toMatchObject({ mode: 'plan', changed: 1 });
    expect(f.summary()).toBeUndefined();
    expect(await backfillScheduledJobStatuses(f.database, { ...options, apply: true })).toMatchObject({ changed: 1 });
    expect(f.summary()).toMatchObject({ latestRun: { status: 'FAILED' }, latestSuccessfulRun: { occurrenceId: `${jobName}:old` } });
    expect(await backfillScheduledJobStatuses(f.database, { ...options, apply: true })).toMatchObject({ changed: 0 });
    const run = await f.start('newest', '2026-09-19T00:00:00.000Z');
    const before = f.summary();
    expect(await backfillScheduledJobStatuses(f.database, { ...options, apply: true })).toMatchObject({ changed: 0 });
    expect(f.summary()).toEqual(before);
    expect(f.summary()).toMatchObject({ latestRun: { occurrenceId: run.runId } });
  });
});

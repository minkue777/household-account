import type * as firestore from 'firebase-admin/firestore';
import { expect, it, vi } from 'vitest';
import { FirebaseAdminDashboardReader } from '../../../src/adapters/firebase/admin/firebaseAdminDashboardReader';
import type { AdminFunctionLatencyReaderPort } from '../../../src/platform/admin-operations/application/adminOperationsDashboard';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  type Snapshot = { docs: { id: string; data(): Record<string, unknown> }[] };
  const first = deferred<Snapshot>();
  const second = deferred<Snapshot>();
  const memberReads = [vi.fn(() => first.promise), vi.fn(() => second.promise)];
  const householdRead = vi.fn(async () => ({
    docs: memberReads.map((get, index) => ({
      id: `household-${index}`,
      data: () => ({ name: `가구 ${index}`, aggregateVersion: 1 }),
      ref: { collection: () => ({ get }) },
    })),
  }));
  const emptyQuery = {
    get: async () => ({ docs: [] }),
    doc: () => ({ collection: () => emptyQuery }),
    orderBy: () => emptyQuery,
    limit: () => emptyQuery,
    where: () => emptyQuery,
  };
  const database = {
    collection: (name: string) => name === 'households' ? { get: householdRead } : emptyQuery,
    doc: () => ({ get: async () => ({ data: () => undefined }) }),
  } as unknown as firestore.Firestore;
  const latency = deferred<Awaited<ReturnType<AdminFunctionLatencyReaderPort['read']>>>();
  const read = () => new FirebaseAdminDashboardReader(database, {
    serviceName: 'test', revision: 'test', region: 'test',
  }, { read: () => latency.promise }).read({ generatedAt: '2026-09-07T12:00:00Z', rangeDays: 14 });
  const member = (id: string) => ({ docs: [{ id, data: () => ({ displayName: id }) }] });
  return { first, second, memberReads, householdRead, latency, read, member };
}

it('reads all household members while Cloud Logging is still pending and preserves household ownership', async () => {
  const f = fixture();
  let finished = false;
  const pending = f.read().then(value => { finished = true; return value; });
  await vi.waitFor(() => f.memberReads.forEach(get => expect(get).toHaveBeenCalledTimes(1)));
  expect(f.householdRead).toHaveBeenCalledTimes(1);
  f.second.resolve(f.member('second-member'));
  f.first.resolve(f.member('first-member'));
  await Promise.resolve();
  expect(finished).toBe(false);
  f.latency.resolve({ status: 'available', windowHours: 24, operations: [] });
  const result = await pending;
  expect(result.households.map(h => [h.householdId, h.members.map(m => m.memberId)])).toEqual([
    ['household-0', ['first-member']], ['household-1', ['second-member']],
  ]);
  expect(result.summary.activeMembers).toBe(2);
  expect(result.functionLatency.status).toBe('available');
});

it('keeps household results when Cloud Logging is unavailable', async () => {
  const f = fixture();
  const pending = f.read();
  f.latency.reject(new Error('Logging unavailable'));
  f.first.resolve(f.member('first-member'));
  f.second.resolve(f.member('second-member'));
  const result = await pending;
  expect(result.summary.activeMembers).toBe(2);
  expect(result.functionLatency).toEqual({ status: 'unavailable', windowHours: 24, operations: [] });
});

it('rejects a member read failure without waiting for Cloud Logging or returning incomplete member counts', async () => {
  const f = fixture();
  const pending = f.read();
  const rejected = expect(pending).rejects.toThrow('Member read unavailable');
  await vi.waitFor(() => expect(f.memberReads[0]).toHaveBeenCalledTimes(1));
  f.first.reject(new Error('Member read unavailable'));
  await rejected;
  f.second.resolve(f.member('second-member'));
  f.latency.reject(new Error('Logging also unavailable'));
});

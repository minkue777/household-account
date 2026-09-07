import type { Firestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirebaseMemberAccessStore } from '../../../src/adapters/firebase/operations/firebaseMemberAccessStore';
import { InMemoryFirestore } from '../../support/in-memory-firestore';

type MemoryTransaction = Parameters<Parameters<InMemoryFirestore['runTransaction']>[0]>[0];

afterEach(() => vi.useRealTimers());

describe('Firebase 접속 집계의 지속적인 방문 멱등성', () => {
  it('128개 이후와 서비스 재생성 뒤에도 오래된 방문을 다시 합산하지 않고 다른 멤버는 독립 집계한다', async () => {
    const memory = new InMemoryFirestore();
    const database = memory as unknown as Firestore;
    const event = { householdId: 'h1', memberId: 'm1', visitId: 'v0', platform: 'web' as const, accessedAt: '2026-09-06T00:00:00.000Z' };
    const store = new FirebaseMemberAccessStore(database);
    for (let i = 0; i < 130; i += 1) {
      await store.record({ ...event, visitId: `v${i}` });
    }
    const resumed = new FirebaseMemberAccessStore(database);
    expect(await resumed.record(event)).toEqual({ kind: 'already-recorded', totalAccessCount: 130 });
    expect(await resumed.record({ ...event, memberId: 'm2' })).toEqual({ kind: 'recorded', totalAccessCount: 1 });
    expect(memory.documentsInCollection('operations/runtime/memberAccessVisits')).toHaveLength(131);
  });

  it('방문 집계와 중복 영수증을 한 번의 원자적 읽기로 받고 같은 방문은 재합산하지 않는다', async () => {
    vi.useFakeTimers();
    const memory = new InMemoryFirestore();
    const batches: string[][] = [];
    const database = {
      collection: memory.collection.bind(memory),
      runTransaction: <T>(operation: (transaction: MemoryTransaction) => Promise<T>) =>
        memory.runTransaction(async transaction => {
          const getAll = transaction.getAll.bind(transaction);
          transaction.getAll = async (...references) => {
            batches.push(references.map(reference => reference.path));
            await new Promise(resolve => setTimeout(resolve, 100));
            return getAll(...references);
          };
          return operation(transaction);
        }),
    } as unknown as Firestore;
    const store = new FirebaseMemberAccessStore(database);
    const event = { householdId: 'h1', memberId: 'm1', visitId: 'visit', platform: 'ios-pwa' as const, accessedAt: '2026-09-07T00:00:00.000Z' };
    const statsId = createHash('sha256').update('h1\u0000m1').digest('hex');
    const visitId = createHash('sha256').update(JSON.stringify(['h1', 'm1', 'visit'])).digest('hex');
    const first = store.record(event);
    expect(memory.documentsInCollection('operations/runtime/memberAccessStats')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    await expect(first).resolves.toEqual({ kind: 'recorded', totalAccessCount: 1 });
    expect(batches).toEqual([[
      `operations/runtime/memberAccessStats/${statsId}`,
      `operations/runtime/memberAccessVisits/${visitId}`,
    ]]);
    const replay = store.record(event);
    await vi.advanceTimersByTimeAsync(100);
    await expect(replay).resolves.toEqual({ kind: 'already-recorded', totalAccessCount: 1 });
    expect(memory.documentsInCollection('operations/runtime/memberAccessVisits')).toHaveLength(1);
    expect(memory.documentsInCollection('operations/runtime/memberAccessStats')[0].value.platformCounts).toEqual({ android: 0, 'ios-pwa': 1, web: 0 });
  });

  it('일괄 읽기가 실패하면 영수증과 집계를 모두 기록하지 않고 다음 시도에 정상 기록한다', async () => {
    const memory = new InMemoryFirestore();
    let fail = true;
    const database = {
      collection: memory.collection.bind(memory),
      runTransaction: <T>(operation: (transaction: MemoryTransaction) => Promise<T>) =>
        memory.runTransaction(async transaction => {
          if (fail) transaction.getAll = async () => { throw new Error('batch read unavailable'); };
          return operation(transaction);
        }),
    } as unknown as Firestore;
    const store = new FirebaseMemberAccessStore(database);
    const event = { householdId: 'h1', memberId: 'm1', visitId: 'visit', platform: 'android' as const, accessedAt: '2026-09-07T00:00:00.000Z' };
    await expect(store.record(event)).rejects.toThrow('batch read unavailable');
    expect(memory.documentsInCollection('operations/runtime/memberAccessStats')).toHaveLength(0);
    expect(memory.documentsInCollection('operations/runtime/memberAccessVisits')).toHaveLength(0);
    fail = false;
    await expect(store.record(event)).resolves.toEqual({ kind: 'recorded', totalAccessCount: 1 });
  });
});

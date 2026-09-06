import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { FirebaseMemberAccessStore } from '../../../src/adapters/firebase/operations/firebaseMemberAccessStore';
import { InMemoryFirestore } from '../../support/in-memory-firestore';

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
});

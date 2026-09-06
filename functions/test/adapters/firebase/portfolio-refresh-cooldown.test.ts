import type * as firestore from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { FirebasePortfolioRefreshLease } from '../../../src/adapters/firebase/portfolio/firebasePortfolioRefreshLease';
import { receiptReference } from '../../../src/adapters/firebase/portfolio/firebasePortfolioRuntimeDocuments';
import { InMemoryFirestore } from '../../support/in-memory-firestore';

const metadata = (id: string, uid = 'uid') => ({ householdId: 'home', principalUid: uid, actorMemberId: 'member', commandId: id, idempotencyKey: id, commandName: 'portfolio.refresh-market-values.v1', payloadFingerprint: id, occurredAt: '2000-01-01T00:00:00Z' });
describe('market refresh durable cooldown', () => {
  it('release does not remove caller cooldown and client occurredAt cannot bypass it', async () => {
    const memory = new InMemoryFirestore();
    let now = 1_000_000;
    const lease = new FirebasePortfolioRefreshLease(memory as unknown as firestore.Firestore, () => now);
    expect(await lease.acquire(metadata('a'), 'all')).toEqual({ kind: 'acquired' });
    await lease.release(metadata('a'), 'all');
    expect(await lease.acquire({ ...metadata('b'), occurredAt: '2099-01-01T00:00:00Z' }, 'all')).toEqual({ kind: 'rate-limited', retryAfterMs: 30_000 });
    now += 30_000;
    expect(await lease.acquire(metadata('b'), 'all')).toEqual({ kind: 'acquired' });
  });
  it('pending receipt resumes completed target keys even after another command owned cooldown', async () => {
    const memory = new InMemoryFirestore();
    const database = memory as unknown as firestore.Firestore;
    const lease = new FirebasePortfolioRefreshLease(database, () => 1_000_000);
    await lease.acquire(metadata('other'), 'all'); await lease.release(metadata('other'), 'all');
    memory.seed(receiptReference(database, metadata('retry')).path, { status: 'pending', payloadFingerprint: 'retry', completedTargetKeys: ['stock:A'], result: { kind: 'error' } });
    expect(await lease.acquire(metadata('retry'), 'all')).toEqual({ kind: 'acquired', completedTargetKeys: ['stock:A'] });
  });
});

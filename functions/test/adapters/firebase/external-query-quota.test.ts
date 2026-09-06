import type * as firestore from 'firebase-admin/firestore';
import { expect, it, vi } from 'vitest';
import { FirebaseExternalQueryQuota } from '../../../src/adapters/firebase/operations/firebaseExternalQueryQuota';
import { createHouseholdQueryRouter } from '../../../src/bootstrap/queries/householdQueryRouter';
import { InMemoryFirestore } from '../../support/in-memory-firestore';

it('actual router applies durable actor and IP quota before a provider handler and resets by server time', async () => {
  const memory = new InMemoryFirestore();
  let now = 1000;
  const handler = { execute: vi.fn(async () => ({ price: 1 })) };
  const router = createHouseholdQueryRouter({ handlers: new Map([['portfolio.get-instrument-quote.v1', handler]]),
    memberships: { resolveActor: async ({ principalUid, householdId }) => ({ kind: 'active', actor: { principalUid, householdId, actingMemberId: 'member', capabilities: [] } }) },
    externalQueryQuota: new FirebaseExternalQueryQuota(memory as unknown as firestore.Firestore, () => now, { principal: 2, ip: 3, windowMs: 60000 }),
  });
  const execute = (uid: string, ip = '127.0.0.1') => router.execute({ principalUid: uid, sourceIp: ip, request: { contractVersion: 'household-query.v1', queryId: 'q', householdId: 'home', query: 'portfolio.get-instrument-quote.v1', payload: { code: 'A', market: 'US' } } });
  await execute('a'); await execute('a');
  expect(await execute('a')).toMatchObject({ kind: 'error', code: 'EXTERNAL_QUERY_RATE_LIMITED' });
  await execute('b');
  expect(await execute('c')).toMatchObject({ kind: 'error', code: 'EXTERNAL_QUERY_RATE_LIMITED' });
  expect(handler.execute).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(memory.paths('operations/runtime/externalQueryQuotas/'))).not.toContain('127.0.0.1');
  now += 60000; expect(await execute('a')).toMatchObject({ kind: 'success' });
  expect(handler.execute).toHaveBeenCalledTimes(4);
});

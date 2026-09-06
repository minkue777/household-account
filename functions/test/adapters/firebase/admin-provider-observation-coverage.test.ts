import type * as firestore from 'firebase-admin/firestore';
import { expect, it } from 'vitest';
import { FirebaseAdminDashboardReader, EXPECTED_PROVIDER_OPERATIONS } from '../../../src/adapters/firebase/admin/firebaseAdminDashboardReader';
import { InMemoryFirestore } from '../../support/in-memory-firestore';
import { loadScheduledJobDefinitions } from '../../../src/operations/scheduling/scheduledJobDefinitions';

it('one observed healthy route cannot conceal other unobserved providers', async () => {
  const memory = new InMemoryFirestore();
  const database = Object.assign(memory, { doc: (path: string) => { const parts = path.split('/'); const id = parts.pop()!; return memory.collection(parts.join('/')).doc(id); } }) as unknown as firestore.Firestore;
  for (const definition of loadScheduledJobDefinitions().definitions) memory.seed('operations/runtime/scheduledJobRuns/' + definition.jobName, { jobName: definition.jobName, status: 'COMPLETE', scheduledFor: '2026-09-06T00:00:00Z' });
  memory.seed('operations/runtime/providerHealth/only', { provider: 'upbit', operation: 'market-quote', status: 'healthy', lastAttemptAt: '2026-09-06T00:00:00Z' });
  const result = await new FirebaseAdminDashboardReader(database, { serviceName: 'test', revision: 'revision', region: 'region' }).read({ generatedAt: '2026-09-06T01:00:00Z', rangeDays: 1 });
  expect(result.service.health).toBe('degraded');
  expect(result.providerHealth).toHaveLength(EXPECTED_PROVIDER_OPERATIONS.length);
  const unknown = result.providerHealth.filter(row => row.status === 'unknown');
  expect(unknown).toHaveLength(EXPECTED_PROVIDER_OPERATIONS.length - 1);
  unknown.forEach(row => { expect(row.lastAttemptAt).toBeUndefined(); expect(row.lastSuccessAt).toBeUndefined(); expect(row.lastResultKind).toBe('NOT_OBSERVED'); });
  expect(result.summary.unhealthyProviders).toBe(unknown.length);
});

import type * as firestore from 'firebase-admin/firestore';
import { expect, it } from 'vitest';
import { FirebaseAdminDashboardReader } from '../../../src/adapters/firebase/admin/firebaseAdminDashboardReader';
import { InMemoryFirestore } from '../../support/in-memory-firestore';

it('[T-ADM-004] groups active Android versions per household member using the latest confirmation per version', async () => {
  const memory = new InMemoryFirestore();
  const database = Object.assign(memory, { doc: (path: string) => {
    const parts = path.split('/');
    return memory.collection(parts.slice(0, -1).join('/')).doc(parts.at(-1)!);
  } }) as unknown as firestore.Firestore;
  for (const id of ['one', 'two']) {
    memory.seed(`households/${id}`, { name: id });
    memory.seed(`households/${id}/members/member`, { displayName: id, linkedPrincipalUid: `uid-${id}` });
  }
  const endpoint = (id: string, values: Record<string, unknown>) => memory.seed(`notificationEndpoints/${id}`, {
    householdId: 'one', memberId: 'member', platform: 'android', status: 'active', fid: 'private-installation',
    ...values,
  });
  endpoint('first', { deviceInfo: { appVersion: '2.0.12' }, lastConfirmedAt: '2026-11-08T01:00:00Z' });
  endpoint('second', { deviceInfo: { appVersion: '2.0.12' }, lastConfirmedAt: '2026-11-08T02:00:00Z' });
  endpoint('older-version-newer-confirmation', { deviceInfo: { appVersion: '1.2.17' }, lastConfirmedAt: '2026-11-09T01:00:00Z' });
  endpoint('unknown-version', { deviceInfo: { appVersion: ' ' }, lastConfirmedAt: 'invalid' });
  endpoint('foreign-household', { householdId: 'two', deviceInfo: { appVersion: '2.0.11' } });
  endpoint('foreign-member', { memberId: 'absent', deviceInfo: { appVersion: 'wrong-member' } });
  endpoint('inactive', { status: 'inactive', deviceInfo: { appVersion: 'inactive' } });
  endpoint('expired', { expiresAt: '2026-11-09T01:59:59Z', deviceInfo: { appVersion: 'expired' } });
  endpoint('expiry-boundary', { expiresAt: '2026-11-09T02:00:00Z', deviceInfo: { appVersion: 'expiry-boundary' } });
  endpoint('ios', { platform: 'ios-pwa', deviceInfo: { appVersion: 'web-version' } });

  const result = await new FirebaseAdminDashboardReader(database, { serviceName: 'test', revision: 'test', region: 'test' })
    .readOverview({ generatedAt: '2026-11-09T02:00:00Z', rangeDays: 1 });
  expect(result.households.find(row => row.householdId === 'one')?.members[0].androidAppVersions).toEqual([
    { version: '1.2.17', lastConfirmedAt: '2026-11-09T01:00:00.000Z' },
    { version: '2.0.12', lastConfirmedAt: '2026-11-08T02:00:00.000Z' },
    {},
  ]);
  expect(result.households.find(row => row.householdId === 'two')?.members[0].androidAppVersions).toEqual([{ version: '2.0.11' }]);
  expect(JSON.stringify(result)).not.toMatch(/private-installation|endpointId|deviceInfo/);
});

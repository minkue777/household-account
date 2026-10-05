import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNotificationHouseholdCommandHandlers } from '../../../src/bootstrap/commands/notificationHouseholdCommandHandlers';
import type { HouseholdCommandActor } from '../../../src/bootstrap/commands/householdCommand';

const projectId = 'demo-household-mobile-endpoint-commands';
const emulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
emulator('실제 SDK 설치 등록·해제', () => {
  let app: App;
  let db: Firestore;
  beforeAll(async () => {
    app = initializeApp({ projectId }, `mobile-endpoint-${Date.now()}`);
    db = getFirestore(app);
    const cleared = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
    if (!cleared.ok) throw new Error('EMULATOR_RESET_FAILED');
  });
  afterAll(async () => { await db.terminate(); await deleteApp(app); });

  it('[T-PUSH-008][PUSH-002/PUSH-003] 동시 등록은 한 설치를 원자 교체하고 이전 명의·버전의 해제와 현재 설치 로그아웃을 구분한다', async () => {
    const handlers = createNotificationHouseholdCommandHandlers(db);
    const actors: HouseholdCommandActor[] = ['a', 'b'].map(key => ({ principalUid: `uid-${key}`, householdId: `house-${key}`, actingMemberId: `member-${key}`, capabilities: ['household.write'] }));
    const execute = (actor: HouseholdCommandActor, command: string, payload: Record<string, unknown>) => handlers.get(command)!.execute({
      principalUid: actor.principalUid, actor, requestedAt: '2026-10-05T00:00:00.000Z',
      envelope: { contractVersion: 'household-command.v1', command, commandId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), householdId: actor.householdId, payload },
    }) as Promise<{ kind: string; endpointId: string; registrationVersion: number }>;
    const results = await Promise.all(actors.map(actor => execute(actor, 'notifications.register-endpoint.v1', { fid: 'same-installation', platform: 'android', deviceInfo: {} })));
    expect(results.map(value => value.registrationVersion).sort()).toEqual([1, 2]);
    expect(new Set(results.map(value => value.endpointId)).size).toBe(1);
    const reference = db.doc(`notificationEndpoints/${results[0].endpointId}`);
    const saved = (await reference.get()).data()!;
    expect(saved).toMatchObject({ registrationVersion: 2, bindingVersion: 2, status: 'active' });
    expect((await db.collection('notificationEndpoints').get()).size).toBe(1);
    const current = actors.find(actor => actor.householdId === saved.householdId)!;
    const previous = actors.find(actor => actor !== current)!;
    for (const payload of [{ fid: 'same-installation', reason: 'logout' }, { fid: 'same-installation', reason: 'sdk-unregistered', expectedRegistrationVersion: 2 }]) {
      expect(await execute(previous, 'notifications.remove-endpoint.v1', payload)).toMatchObject({ kind: 'stale-ignored' });
      expect((await reference.get()).data()).toEqual(saved);
    }
    expect(await execute(current, 'notifications.remove-endpoint.v1', { fid: 'same-installation', reason: 'sdk-unregistered', expectedRegistrationVersion: 1 })).toMatchObject({ kind: 'stale-ignored' });
    expect(await execute(current, 'notifications.remove-endpoint.v1', { fid: 'same-installation', reason: 'sdk-unregistered', expectedRegistrationVersion: 2 })).toMatchObject({ kind: 'inactivated' });
    expect((await reference.get()).data()?.expiresAt?.toDate()).toBeInstanceOf(Date);
    expect(await execute(current, 'notifications.register-endpoint.v1', { fid: 'same-installation', platform: 'ios-pwa' })).toMatchObject({ registrationVersion: 3 });
    const active = (await reference.get()).data()!;
    expect(active).toMatchObject({ status: 'active', bindingVersion: 2 });
    expect(active.expiresAt).toBeUndefined();
    expect(active.inactiveAt).toBeUndefined();
    const other = await execute(current, 'notifications.register-endpoint.v1', { fid: 'other-installation', platform: 'android' });
    expect(await execute(current, 'notifications.remove-endpoint.v1', { fid: 'same-installation', reason: 'logout' })).toMatchObject({ kind: 'removed' });
    expect((await reference.get()).exists).toBe(false);
    expect((await db.doc(`notificationEndpoints/${other.endpointId}`).get()).exists).toBe(true);
  }, 30_000);
});

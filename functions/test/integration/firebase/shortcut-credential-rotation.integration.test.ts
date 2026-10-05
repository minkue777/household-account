import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createShortcutCredentialLifecycleApplication } from '../../../src/contexts/payment-capture/shortcut-ingestion/application/shortcutCredentialLifecycleApplication';
import { FirebaseShortcutCredentialAccessAdapter, FirebaseShortcutCredentialStoreAdapter, HmacShortcutCredentialSecretAdapter } from '../../../src/adapters/firebase/payment-capture/firebaseShortcutCredentialInfrastructure';

const projectId = 'demo-household-credential-rotation';
const emulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
emulator('실제 SDK 단축어 인증정보 교체', () => {
  let app: App;
  let db: Firestore;
  const session = { principalUid: 'uid', householdId: 'house', memberId: 'member', membershipState: 'active', householdState: 'active' } as const;
  const requestedAt = '2026-10-05T01:00:00.000Z';
  const secrets = new HmacShortcutCredentialSecretAdapter({ pepper: () => 'emulator-only-credential-pepper-32-characters', keyVersion: () => 'test.v1', installUrl: () => 'https://www.icloud.com/shortcuts/test' });
  beforeAll(async () => {
    app = initializeApp({ projectId }, `credential-rotation-${Date.now()}`);
    db = getFirestore(app);
    const cleared = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
    if (!cleared.ok) throw new Error('EMULATOR_RESET_FAILED');
    await db.doc('households/house').set({ lifecycleState: 'active' });
    await db.doc('households/house/memberships/uid').set({ householdId: 'house', memberId: 'member', lifecycleState: 'active' });
    await db.doc('households/house/members/member').set({ lifecycleState: 'active' });
  });
  afterAll(async () => { await db.terminate(); await deleteApp(app); });
  const readStored = async (): Promise<Record<string, { path: string; data: FirebaseFirestore.DocumentData }[]>> => Object.fromEntries(await Promise.all(['shortcutCredentials', 'shortcutCredentialSubjects', 'operationReceipts'].map(async collection => [collection, (await db.collectionGroup(collection).get()).docs.map(doc => ({ path: doc.ref.path, data: doc.data() }))])));

  it('[T-IOS-SEC-002][IOS-013] 동시 재발급·재전송은 활성 hash 하나로 수렴하며 실제 저장 문서와 관측 로그에 원문을 남기지 않는다', async () => {
    const application = createShortcutCredentialLifecycleApplication({ access: new FirebaseShortcutCredentialAccessAdapter(db), store: new FirebaseShortcutCredentialStoreAdapter(db), secrets });
    const logs = [vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'log')];
    try {
      const first = await application.issue({ session, requestedAt, idempotencyKey: 'issue', issuanceMode: 'if-absent' });
      if (first.kind !== 'issued') throw new Error(`ISSUE_FAILED:${first.kind}`);
      const command = { session, requestedAt, currentCredentialId: first.credentialId, expectedVersion: first.credentialVersion };
      const commands = ['rotate-a', 'rotate-b'].map(idempotencyKey => ({ ...command, idempotencyKey }));
      const results = await Promise.all(commands.map(value => application.reissue(value)));
      expect(results.map(value => value.kind).sort()).toEqual(['alreadyIssued', 'issued']);
      const winnerIndex = results.findIndex(value => value.kind === 'issued');
      const winner = results[winnerIndex];
      if (winner.kind !== 'issued') throw new Error('WINNER_MISSING');
      expect(results).toEqual(expect.arrayContaining([
        expect.objectContaining({ credentialId: winner.credentialId, credentialVersion: 2 }),
      ]));
      expect(results[1 - winnerIndex]).toEqual({ kind: 'alreadyIssued', credentialId: winner.credentialId, credentialVersion: 2 });
      expect(await application.reissue(commands[winnerIndex])).toEqual({ kind: 'alreadyIssued', credentialId: winner.credentialId, credentialVersion: 2 });
      expect(await application.authorize({ bearerCredential: first.rawCredential, requestedAt, distinguishReplacement: true })).toMatchObject({ kind: 'unauthenticated', code: 'CREDENTIAL_REPLACED' });
      expect(await application.authorize({ bearerCredential: winner.rawCredential, requestedAt })).toMatchObject({ kind: 'authorized', actor: { principalUid: 'uid' } });
      const stored = await readStored();
      expect(stored.shortcutCredentials).toHaveLength(2);
      expect(stored.shortcutCredentials.filter(value => value.data.status === 'active')).toEqual([
        expect.objectContaining({ data: expect.objectContaining({ credentialId: winner.credentialId, credentialVersion: 2, secretHash: secrets.hash(winner.rawCredential) }) }),
      ]);
      for (const raw of [first.rawCredential, winner.rawCredential]) {
        expect(JSON.stringify(stored)).not.toContain(raw);
        expect(JSON.stringify(logs.map(log => log.mock.calls))).not.toContain(raw);
      }

      const beforeFailure = await readStored();
      const runTransaction = db.runTransaction.bind(db);
      const failingCommit = vi.spyOn(db, 'runTransaction').mockImplementation(operation => runTransaction(async transaction => {
        await operation(transaction);
        throw new Error('TEST_ABORT_BEFORE_COMMIT');
      }));
      try {
        expect(await application.reissue({ session, requestedAt, currentCredentialId: winner.credentialId, expectedVersion: 2, idempotencyKey: 'aborted-rotation' })).toEqual({ kind: 'retryableFailure', code: 'CREDENTIAL_COMMIT_UNAVAILABLE' });
      } finally { failingCommit.mockRestore(); }
      expect(await readStored()).toEqual(beforeFailure);
      expect(await application.authorize({ bearerCredential: winner.rawCredential, requestedAt })).toMatchObject({ kind: 'authorized' });
    } finally { logs.forEach(log => log.mockRestore()); }
  }, 30_000);
});

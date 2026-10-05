import { deleteApp, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { afterAll, describe, expect, it } from 'vitest';
import { InMemoryFirestore } from '../../support/in-memory-firestore';

const withEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
withEmulator('Firestore 저장 대역과 실제 SDK의 중첩 필드 의미', () => {
  const app = initializeApp({ projectId: 'demo-firestore-double-semantics' }, 'double-semantics');
  const db = getFirestore(app);
  afterAll(() => deleteApp(app));

  it('merge는 leaf를 보존하고 mergeFields·update는 지정 map을 교체한다', async () => {
    const actual = db.doc('records/value');
    const memory = new InMemoryFirestore();
    const fake = memory.doc('records/value');
    const initial = { daily: { old: 1, recent: 2 }, keep: 'yes' };
    await actual.set(initial);
    await fake.set(initial);
    for (const options of [{ merge: true }, { mergeFields: ['daily'] }]) {
      await actual.set({ daily: { today: 3 } }, options);
      await fake.set({ daily: { today: 3 } }, options);
      expect((await fake.get()).data()).toEqual((await actual.get()).data());
    }
    expect((await actual.get()).get('daily')).toEqual({ today: 3 });
    await db.runTransaction(async tx => {
      await tx.get(actual);
      tx.update(actual, { daily: { next: 4 }, 'nested.a': 1 });
    });
    await memory.runTransaction(async tx => {
      await tx.get(fake);
      tx.update(fake, { daily: { next: 4 }, 'nested.a': 1 });
    });
    expect((await fake.get()).data()).toEqual((await actual.get()).data());
    await actual.set({ daily: {}, nested: { a: FieldValue.delete() } }, { merge: true });
    await fake.set({ daily: {}, nested: { a: FieldValue.delete() } }, { merge: true });
    expect((await fake.get()).data()).toEqual((await actual.get()).data());
    expect((await fake.get()).get('keep')).toBe('yes');
  });
});

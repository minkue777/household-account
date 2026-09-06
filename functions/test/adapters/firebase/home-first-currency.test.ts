import type * as firestore from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { FirebaseLocalCurrencyBalanceStore } from '../../../src/adapters/firebase/local-currency/firebaseLocalCurrencyBalanceStore';
import { InMemoryFirestore } from '../../support/in-memory-firestore';

describe('first balance and Home selection transaction', () => {
  it('persists first type with zero balance and preserves it when another type arrives', async () => {
    const memory = new InMemoryFirestore();
    memory.seed('households/home', { lifecycleState: 'active', homeSummaryConfigVersion: 2 });
    const store = new FirebaseLocalCurrencyBalanceStore(memory as unknown as firestore.Firestore);
    const save = (type: 'gyeonggi' | 'daejeon') => store.runInHouseholdTransaction('home', tx => tx.saveBalance({ balanceId: type, householdId: 'home', localCurrencyType: type,
      balanceInWon: 0, balanceVersion: 1, observedAt: '2026-09-06T01:00:00Z', updatedAt: '2026-09-06T01:00:00Z', schemaVersion: 2, lastObservationId: type }));
    await save('gyeonggi');
    expect(memory.document('households/home/homePreferences/home')).toMatchObject({ selectedLocalCurrencyType: 'gyeonggi', aggregateVersion: 3 });
    expect(memory.document('households/home/localCurrencyBalances/gyeonggi')).toMatchObject({ balanceInWon: 0 });
    await save('daejeon');
    expect(memory.document('households/home/homePreferences/home')).toMatchObject({ selectedLocalCurrencyType: 'gyeonggi', aggregateVersion: 3 });
    expect(memory.paths('outboxEvents/')).toHaveLength(1);
  });
  it('does not select an arbitrary type when the first migrated inventory already contains several types', async () => {
    const memory = new InMemoryFirestore();
    memory.seed('households/home', { lifecycleState: 'active' });
    memory.seed('balances/old', { householdId: 'home', localCurrencyType: 'daejeon', balance: 1 });
    const store = new FirebaseLocalCurrencyBalanceStore(memory as unknown as firestore.Firestore);
    await store.runInHouseholdTransaction('home', tx => tx.saveBalance({ balanceId: 'gyeonggi', householdId: 'home', localCurrencyType: 'gyeonggi', balanceInWon: 0, balanceVersion: 1, observedAt: '2026-09-06T01:00:00Z', updatedAt: '2026-09-06T01:00:00Z', schemaVersion: 2, lastObservationId: 'a' }));
    expect(memory.document('households/home/homePreferences/home')).toBeUndefined();
    expect(memory.paths('outboxEvents/')).toHaveLength(0);
  });
});

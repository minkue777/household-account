import {
  collection,
  db,
  onSnapshot,
  query,
  timestampToDate,
  where,
} from '@/platform/read-model/firestoreReadModel';
import { requireClientSessionScope } from '@/composition/clientSessionScope';

export interface LocalCurrencyBalance {
  balance: number;
  currencyType: string;
  updatedAt: Date | null;
}

/**
 * 지역화폐 잔액 실시간 구독
 */
export function subscribeToLocalCurrencyBalance(
  callback: (balance: LocalCurrencyBalance | null) => void
): () => void {
  const householdKey = requireClientSessionScope().householdId;

  const balancesRef = collection(db, 'balances');
  const q = query(
    balancesRef,
    where('householdId', '==', householdKey),
    where('type', '==', 'localCurrency')
  );

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      if (snapshot.empty) {
        callback(null);
        return;
      }

      const data = snapshot.docs[0].data();
      callback({
        balance: data.balance || 0,
        currencyType: data.currencyType || '지역화폐',
        updatedAt: timestampToDate(data.updatedAt) ?? null,
      });
    },
    (error) => {
      console.error('잔액 구독 오류:', error);
      callback(null);
    }
  );

  return unsubscribe;
}

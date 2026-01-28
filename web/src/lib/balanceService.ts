import { doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from './firebase';
import { getStoredHouseholdKey } from './householdService';

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
  const householdKey = getStoredHouseholdKey();
  if (!householdKey) {
    callback(null);
    return () => {};
  }

  const docRef = doc(db, 'households', householdKey, 'balances', 'localCurrency');

  const unsubscribe = onSnapshot(
    docRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }

      const data = snapshot.data();
      callback({
        balance: data.balance || 0,
        currencyType: data.currencyType || '지역화폐',
        updatedAt: data.updatedAt instanceof Timestamp
          ? data.updatedAt.toDate()
          : null,
      });
    },
    (error) => {
      console.error('잔액 구독 오류:', error);
      callback(null);
    }
  );

  return unsubscribe;
}

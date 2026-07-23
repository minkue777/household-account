import {
  collection,
  db,
  doc,
  onSnapshot,
  timestampToDate,
} from '@/platform/read-model/firestoreReadModel';
import { requireClientSessionScope } from '@/composition/clientSessionScope';

export interface LocalCurrencyBalance {
  balance: number;
  currencyType: string;
  updatedAt: Date | null;
}

/**
 * 선택된 지역화폐의 최신 잔액을 구독합니다.
 */
export function subscribeToLocalCurrencyBalance(
  callback: (balance: LocalCurrencyBalance | null) => void
): () => void {
  const scope = requireClientSessionScope();
  let balances = new Map<string, LocalCurrencyBalance>();
  let balancesLoaded = false;
  let preferenceLoaded = false;
  let selectedType: string | undefined;

  const emitCanonicalSelection = () => {
    if (!balancesLoaded) return;

    if (selectedType !== undefined) {
      callback(balances.get(selectedType) ?? null);
      return;
    }

    if (balances.size === 1) {
      callback(balances.values().next().value ?? null);
      return;
    }

    // 여러 유형이 있으면 Home Preferences의 명시적 선택을 기다립니다.
    if (preferenceLoaded) callback(null);
  };

  const balancesReference = collection(
    db,
    'households',
    scope.householdId,
    'localCurrencyBalances'
  );
  const preferenceReference = doc(
    db,
    'households',
    scope.householdId,
    'homePreferences',
    'home'
  );

  const unsubscribeBalances = onSnapshot(
    balancesReference,
    (snapshot) => {
      balances = new Map(
        snapshot.docs.flatMap((balanceDocument) => {
          const data = balanceDocument.data();
          const currencyType =
            typeof data.localCurrencyType === 'string' && data.localCurrencyType.trim() !== ''
              ? data.localCurrencyType.trim()
              : balanceDocument.id;
          const rawBalance = data.balanceInWon ?? data.balance;
          if (!Number.isSafeInteger(rawBalance)) return [];
          const updatedAt =
            timestampToDate(data.updatedAt)
            ?? (
              typeof data.observedAt === 'string'
                ? new Date(data.observedAt)
                : null
            );
          return [[
            currencyType,
            {
              balance: rawBalance as number,
              currencyType,
              updatedAt:
                updatedAt instanceof Date && !Number.isNaN(updatedAt.getTime())
                  ? updatedAt
                  : null,
            },
          ] as const];
        })
      );
      balancesLoaded = true;
      emitCanonicalSelection();
    },
    (error) => {
      console.error('지역화폐 잔액 구독 오류:', error);
    }
  );

  const unsubscribePreference = onSnapshot(
    preferenceReference,
    (snapshot) => {
      const data = snapshot.exists() ? snapshot.data() : undefined;
      selectedType =
        typeof data?.selectedLocalCurrencyType === 'string'
        && data.selectedLocalCurrencyType.trim() !== ''
          ? data.selectedLocalCurrencyType.trim()
          : undefined;
      preferenceLoaded = true;
      emitCanonicalSelection();
    },
    (error) => {
      console.error('지역화폐 선택 설정 구독 오류:', error);
    }
  );

  return () => {
    unsubscribeBalances();
    unsubscribePreference();
  };
}

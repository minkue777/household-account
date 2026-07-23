import {
  collection,
  db,
  doc,
  onSnapshot,
  timestampToDate,
} from '@/platform/read-model/firestoreReadModel';
import { requireClientSessionScope } from '@/composition/clientSessionScope';
import {
  readCachedLocalCurrencyBalance,
  writeCachedLocalCurrencyBalance,
  type LocalCurrencyBalance,
} from '@/features/local-currency/application/localCurrencyBalanceCache';

export type { LocalCurrencyBalance };

function balanceSignature(balance: LocalCurrencyBalance | null): string {
  return balance === null
    ? 'none'
    : `${balance.currencyType}:${balance.balance}:${balance.updatedAt?.toISOString() ?? ''}`;
}

/**
 * 선택된 지역화폐의 최신 잔액을 구독합니다.
 *
 * 마지막 성공값은 가구·로그인 사용자별 로컬 캐시에 보관해 첫 화면에서 즉시
 * 표시하고, 권위 데이터는 가구 하위 canonical read model로 갱신합니다.
 */
export function subscribeToLocalCurrencyBalance(
  callback: (balance: LocalCurrencyBalance | null) => void
): () => void {
  const scope = requireClientSessionScope();
  let balances = new Map<string, LocalCurrencyBalance>();
  let balancesLoaded = false;
  let preferenceLoaded = false;
  let selectedType: string | undefined;
  let lastSignature: string | undefined;

  const emit = (balance: LocalCurrencyBalance | null, authoritative = false) => {
    const signature = balanceSignature(balance);
    if (signature !== lastSignature) {
      lastSignature = signature;
      callback(balance);
    }
    if (authoritative) writeCachedLocalCurrencyBalance(scope, balance);
  };

  const cached = readCachedLocalCurrencyBalance();
  if (cached !== null) emit(cached);

  const emitCanonicalSelection = () => {
    if (!balancesLoaded) return;

    if (selectedType !== undefined) {
      emit(balances.get(selectedType) ?? null, true);
      return;
    }

    if (balances.size === 1) {
      emit(balances.values().next().value ?? null, true);
      return;
    }

    // 여러 유형이 있으면 Home Preferences의 명시적 선택을 기다립니다.
    if (preferenceLoaded) emit(null, true);
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
      // 일시적인 Auth/네트워크 오류에는 마지막 성공값을 지우지 않습니다.
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
      // 설정 문서의 일시 오류도 기존 표시값을 없애는 근거가 아닙니다.
      console.error('지역화폐 선택 설정 구독 오류:', error);
    }
  );

  return () => {
    unsubscribeBalances();
    unsubscribePreference();
  };
}

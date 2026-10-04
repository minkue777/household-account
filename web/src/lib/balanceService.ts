import { subscribeWithInitialHomeRead } from '@/platform/read-model/initialHomeRead';
import { subscribeToHomePreferencesDocument } from '@/platform/read-model/homePreferencesReadModel';
import {
  collection,
  db,
  onSnapshot,
  timestampToDate,
} from '@/platform/read-model/firestoreReadModel';
import { getClientSessionScope, requireClientSessionScope } from '@/composition/clientSessionScope';
import { recordClientStartupTiming } from '@/platform/performance/clientStartupDiagnostics';

export interface LocalCurrencyBalance {
  balance: number;
  currencyType: string;
  updatedAt: Date | null;
}

interface LocalCurrencyBalanceSubscriptionOptions {
  onError?: (error: unknown) => void;
}

/**
 * 선택된 지역화폐의 최신 잔액을 구독합니다.
 */
export function subscribeToLocalCurrencyBalance(
  callback: (balance: LocalCurrencyBalance | null) => void,
  options: LocalCurrencyBalanceSubscriptionOptions = {}
): () => void {
  const scope = requireClientSessionScope();
  let active = true;
  let balances = new Map<string, LocalCurrencyBalance>();
  let balancesLoaded = false;
  let preferenceLoaded = false;
  let selectedType: string | undefined;
  let unsubscribePreference: (() => void) | undefined;

  const ensurePreferenceSubscription = () => {
    if (unsubscribePreference !== undefined) return;
    unsubscribePreference = subscribeToHomePreferencesDocument(scope.householdId, data => {
      if (!active || getClientSessionScope() !== scope) return;
      selectedType = typeof data?.selectedLocalCurrencyType === 'string' && data.selectedLocalCurrencyType.trim() !== ''
        ? data.selectedLocalCurrencyType.trim() : undefined;
      preferenceLoaded = true;
      emitCanonicalSelection();
    }, error => { if (active && getClientSessionScope() === scope) options.onError?.(error); });
  };

  const emitCanonicalSelection = () => {
    if (!balancesLoaded || !preferenceLoaded) return;

    if (selectedType !== undefined) {
      callback(balances.get(selectedType) ?? null);
      return;
    }

    // Existing households can have a balance before the first preference is saved.
    // A single currency is unambiguous; an explicit selection still takes priority.
    callback(balances.size === 1 ? balances.values().next().value ?? null : null);
  };

  ensurePreferenceSubscription();
  const balancesReference = collection(
    db,
    'households',
    scope.householdId,
    'localCurrencyBalances'
  );
  const publish = (documents: { id: string; data: () => Record<string, unknown> }[]) => {
    balances = new Map(
      documents.flatMap((balanceDocument) => {
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
  };
  let hasLiveServerSnapshot = false;
  const unsubscribeBalances = subscribeWithInitialHomeRead({
    source: 'currencyBalances', scope,
    read: async () => {
      const server = await import('@/platform/read-model/firestoreServerReadModel');
      return server.getDocsFromServer(server.collection(server.db, 'households', scope.householdId, 'localCurrencyBalances'));
    },
    publish: snapshot => publish(snapshot.docs),
    listen: () => {
      recordClientStartupTiming('currencyBalancesListenStarted');
      return onSnapshot(balancesReference, { includeMetadataChanges: true }, snapshot => {
        if (!active || getClientSessionScope() !== scope) return;
        if (!snapshot.metadata.fromCache) recordClientStartupTiming('currencyBalancesServerSnapshotReceived');
        if (!hasLiveServerSnapshot && snapshot.metadata.fromCache) return;
        hasLiveServerSnapshot = true;
        publish(snapshot.docs);
      }, error => { if (active && getClientSessionScope() === scope) options.onError?.(error); });
    },
  });

  return () => {
    active = false;
    unsubscribeBalances();
    unsubscribePreference?.();
  };
}

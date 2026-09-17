import { collection, db, documentId, getDocsFromServer, limit, orderBy, query, startAfter, where, type QueryDocumentSnapshot, type DocumentData } from '@/platform/read-model/firestoreServerReadModel';
import { getClientSessionScope, requireClientSessionScope } from '@/composition/clientSessionScope';
import type { AssetHistoryEntry } from '@/types/asset';
import { assetStatisticsSessionKey, peekCachedAssetStatistics, readCachedAssetStatistics, type AssetStatisticsReadOptions } from './assetStatisticsQueryCache';

const PAGE_SIZE = 5_000;
const MAX_PAGES = 10; // Preserve the existing 50,000-document safety bound for daily snapshots.

export function peekAssetStatisticsHistory(startDate: string | undefined, endDate: string, options?: AssetStatisticsReadOptions): AssetHistoryEntry[] | undefined {
  return peekCachedAssetStatistics<AssetHistoryEntry[]>(JSON.stringify(['history', startDate, endDate]), options)
    ?.map(entry => ({ ...entry }));
}

export async function readAssetStatisticsHistory(startDate: string | undefined, endDate: string, options?: AssetStatisticsReadOptions): Promise<AssetHistoryEntry[]> {
  const scope = { ...requireClientSessionScope() };
  const assertScope = () => {
    const active = getClientSessionScope();
    if (!active || assetStatisticsSessionKey(active) !== assetStatisticsSessionKey(scope)) throw new Error('STATISTICS_SESSION_CHANGED');
  };
  const result = await readCachedAssetStatistics(JSON.stringify(['history', startDate, endDate]), async assertCacheCurrent => {
    const current = () => {
      assertScope();
      assertCacheCurrent();
    };
    const canonical: AssetHistoryEntry[] = [];
    const canonicalDates = new Set<string>();
    const previousBalances = new Map<string, number>();
    const decode = (document: QueryDocumentSnapshot<DocumentData>) => {
      const data = document.data();
      if (typeof data.localDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.localDate)
        || typeof data.total !== 'number' || !Number.isFinite(data.total)
        || typeof data.financial !== 'number' || !Number.isFinite(data.financial)
        || !data.byType || !data.byOwnerRefKey) throw new Error('STATISTICS_SNAPSHOT_INVALID');
      if (canonicalDates.has(data.localDate)) return;
      canonicalDates.add(data.localDate);
      const amounts: Array<[string, unknown]> = [['TOTAL', data.total], ['FINANCIAL', data.financial],
        ...Object.entries(data.byType).map<[string, unknown]>(([key, amount]) => ['TYPE_' + key, amount]),
        ...Object.entries(data.byOwnerRefKey).map<[string, unknown]>(([key, amount]) => ['OWNER_REF_' + key, amount])];
      // The query already orders daily snapshots. Sort only each day's small
      // dimension list, and calculate changes while decoding each document once.
      amounts.sort(([left], [right]) => left.localeCompare(right));
      for (const [assetId, balance] of amounts) {
        if (typeof assetId !== 'string' || typeof balance !== 'number' || !Number.isFinite(balance)) throw new Error('STATISTICS_SNAPSHOT_INVALID');
        const ownerKey = assetId.startsWith('OWNER_REF_') ? assetId.slice(10) : undefined;
        const previousBalance = previousBalances.get(assetId);
        previousBalances.set(assetId, balance);
        canonical.push({ id: document.id + ':' + assetId, householdId: scope.householdId, assetId, balance,
          date: data.localDate, changeAmount: previousBalance === undefined ? 0 : balance - previousBalance, createdAt: new Date(0),
          ...(ownerKey ? { ownerKey, ownerDisplayName: typeof data.ownerDisplayNames?.[ownerKey] === 'string' ? data.ownerDisplayNames[ownerKey] : ownerKey } : {}),
        });
      }
    };
    const readCanonical = async () => {
      let cursor: QueryDocumentSnapshot<DocumentData> | undefined;
      current();
      const source = collection(db, 'households', scope.householdId, 'assetSnapshots');
      if (startDate) {
        const baseline = await getDocsFromServer(query(source, where('localDate', '<=', startDate), orderBy('localDate', 'desc'), limit(1)));
        current();
        baseline.docs.forEach(decode);
      }
      for (let page = 0; ; page++) {
        if (page >= MAX_PAGES) throw new Error('STATISTICS_PAGE_LIMIT_EXCEEDED');
        current();
        const snapshot: { readonly docs: readonly QueryDocumentSnapshot<DocumentData>[] } = await getDocsFromServer(query(source,
          ...(startDate ? [where('localDate', '>=', startDate)] : []), where('localDate', '<=', endDate),
          orderBy('localDate', 'asc'), orderBy(documentId(), 'asc'), ...(cursor ? [startAfter(cursor)] : []), limit(PAGE_SIZE)));
        current();
        const documents = snapshot.docs;
        documents.forEach(decode);
        if (documents.length < PAGE_SIZE) break;
        const next: QueryDocumentSnapshot<DocumentData> = documents[documents.length - 1];
        if (cursor?.id === next.id) throw new Error('STATISTICS_CURSOR_REPEATED');
        cursor = next;
      }
    };
    await readCanonical();
    current();
    return canonical;
  }, options);
  assertScope();
  return result.map(entry => ({ ...entry }));
}

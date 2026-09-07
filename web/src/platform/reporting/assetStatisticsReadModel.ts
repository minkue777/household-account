import { collection, db, documentId, getDocsFromServer, limit, orderBy, query, startAfter, where, type QueryDocumentSnapshot, type DocumentData } from '@/platform/read-model/firestoreReadModel';
import { getClientSessionScope, requireClientSessionScope } from '@/composition/clientSessionScope';
import type { AssetHistoryEntry } from '@/types/asset';
import { assetStatisticsSessionKey, readCachedAssetStatistics, type AssetStatisticsReadOptions } from './assetStatisticsQueryCache';

const PAGE_SIZE = 500;
const MAX_PAGES = 100; // Preserve the existing 50,000-document safety bound per source.
export async function readAssetStatisticsHistory(startDate: string | undefined, endDate: string, options?: AssetStatisticsReadOptions): Promise<AssetHistoryEntry[]> {
  const scope = { ...requireClientSessionScope() };
  const assertScope = () => {
    const active = getClientSessionScope();
    if (!active || assetStatisticsSessionKey(active) !== assetStatisticsSessionKey(scope)) throw new Error('STATISTICS_SESSION_CHANGED');
  };
  const result = await readCachedAssetStatistics(JSON.stringify(['history', startDate, endDate]), async assertCacheCurrent => {
    let stopped = false;
    const current = () => {
      assertScope();
      assertCacheCurrent();
      if (stopped) throw new Error('STATISTICS_READ_CANCELLED');
    };
    const legacy: AssetHistoryEntry[] = [];
    const seen = new Set<string>();
    // Baseline dimensions may only exist before the selected range, so read this
    // bounded server range to completion, carrying only the latest prior point.
    const baselines = new Map<string, AssetHistoryEntry>();
    const readLegacy = async () => {
      let cursor: QueryDocumentSnapshot<DocumentData> | undefined;
      for (let page = 0; ; page++) {
        if (page >= MAX_PAGES) throw new Error('STATISTICS_PAGE_LIMIT_EXCEEDED');
        current();
        const snapshot = await getDocsFromServer(query(collection(db, 'asset_history'),
          where('householdId', '==', scope.householdId), where('date', '<=', endDate),
          orderBy('date', 'asc'), orderBy(documentId(), 'asc'), ...(cursor ? [startAfter(cursor)] : []), limit(PAGE_SIZE)));
        current();
        for (const document of snapshot.docs) {
          if (seen.has(document.id)) throw new Error('STATISTICS_CURSOR_REPEATED');
          seen.add(document.id);
          const data = document.data();
          if (typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)
            || typeof data.assetId !== 'string' || typeof data.balance !== 'number' || !Number.isFinite(data.balance)) throw new Error('STATISTICS_SNAPSHOT_INVALID');
          const entry: AssetHistoryEntry = { id: document.id, householdId: scope.householdId, assetId: data.assetId, date: data.date,
            balance: data.balance, changeAmount: typeof data.changeAmount === 'number' ? data.changeAmount : 0, createdAt: new Date(0) };
          if (startDate && entry.date < startDate) baselines.set(entry.assetId, entry);
          else legacy.push(entry);
        }
        if (snapshot.docs.length < PAGE_SIZE) break;
        cursor = snapshot.docs[snapshot.docs.length - 1];
      }
    };
    const canonical: AssetHistoryEntry[] = [];
    const canonicalDates = new Set<string>();
    const decode = (document: QueryDocumentSnapshot<DocumentData>) => {
      const data = document.data();
      if (typeof data.localDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.localDate)
        || typeof data.total !== 'number' || !Number.isFinite(data.total)
        || typeof data.financial !== 'number' || !Number.isFinite(data.financial)
        || !data.byType || !data.byOwnerRefKey) throw new Error('STATISTICS_SNAPSHOT_INVALID');
      canonicalDates.add(data.localDate);
      const amounts = [['TOTAL', data.total], ['FINANCIAL', data.financial],
        ...Object.entries(data.byType).map(([key, amount]) => ['TYPE_' + key, amount]),
        ...Object.entries(data.byOwnerRefKey).map(([key, amount]) => ['OWNER_REF_' + key, amount])];
      for (const [assetId, balance] of amounts) {
        if (typeof assetId !== 'string' || typeof balance !== 'number' || !Number.isFinite(balance)) throw new Error('STATISTICS_SNAPSHOT_INVALID');
        const ownerKey = assetId.startsWith('OWNER_REF_') ? assetId.slice(10) : undefined;
        canonical.push({ id: document.id + ':' + assetId, householdId: scope.householdId, assetId, balance,
          date: data.localDate, changeAmount: 0, createdAt: new Date(0),
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
        for (const document of snapshot.docs) {
          if (canonicalDates.has(document.data().localDate)) continue;
          decode(document);
        }
        if (snapshot.docs.length < PAGE_SIZE) break;
        const next: QueryDocumentSnapshot<DocumentData> = snapshot.docs[snapshot.docs.length - 1];
        if (cursor?.id === next.id) throw new Error('STATISTICS_CURSOR_REPEATED');
        cursor = next;
      }
    };
    // Independent compatibility and canonical streams may run together; neither
    // contributes visible totals until both have completed every bounded page.
    await Promise.all([readLegacy(), readCanonical()]).catch(error => {
      stopped = true;
      throw error;
    });
    current();
    const merged = [...legacy, ...Array.from(baselines.values())].filter(entry => !canonicalDates.has(entry.date))
      .concat(canonical).sort((left, right) => left.date.localeCompare(right.date) || left.assetId.localeCompare(right.assetId));
    const previous = new Map<string, number>();
    return merged.map(entry => {
      const before = previous.get(entry.assetId);
      previous.set(entry.assetId, entry.balance);
      return { ...entry, changeAmount: before === undefined ? entry.changeAmount : entry.balance - before };
    });
  }, options);
  assertScope();
  return result.map(entry => ({ ...entry }));
}

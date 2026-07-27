import type { PreviousAssetDailySummary } from '@/features/portfolio/application/dailyAssetChangeSummary';
import {
  collection,
  db,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from '@/platform/read-model/firestoreReadModel';

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function finiteNumberRecord(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === 'number' && Number.isFinite(entry)
        ? [[key, entry] as const]
        : []
    )
  );
}

/**
 * 오늘보다 앞선 Canonical 자산 일일 요약 중 가장 최근 문서 한 건만 읽습니다.
 */
export async function readPreviousAssetDailySummary(
  householdId: string,
  beforeLocalDate: string
): Promise<PreviousAssetDailySummary | undefined> {
  const result = await getDocs(
    query(
      collection(db, 'households', householdId, 'assetSnapshots'),
      where('localDate', '<', beforeLocalDate),
      orderBy('localDate', 'desc'),
      limit(1)
    )
  );
  if (result.empty) {
    return undefined;
  }

  const snapshot = result.docs[0];
  const data = snapshot.data();
  return {
    localDate:
      typeof data.localDate === 'string' ? data.localDate : snapshot.id,
    total: finiteNumber(data.total),
    byOwnerRefKey: finiteNumberRecord(data.byOwnerRefKey),
  };
}

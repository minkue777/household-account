/**
 * Web read-side 전용 Firestore 경계입니다.
 *
 * 이 모듈은 Query/listener API만 노출합니다. Command 측 변경 API와
 * transaction/batch API는 Functions 경계를 거치도록 의도적으로 제외합니다.
 */
export {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocFromCache,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

export { db } from '@/lib/firebase';

interface TimestampLike {
  toDate(): Date;
}

export function timestampToDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as TimestampLike).toDate === 'function'
  ) {
    return (value as TimestampLike).toDate();
  }
  return undefined;
}

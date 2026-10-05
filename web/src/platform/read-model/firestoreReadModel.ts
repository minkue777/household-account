/**
 * Web read-side 전용 Firestore 경계입니다.
 *
 * 이 모듈은 Query/listener API만 노출합니다. Command 측 변경 API와
 * transaction/batch API는 Functions 경계를 거치도록 의도적으로 제외합니다.
 */
import { onSnapshot as firebaseOnSnapshot, type DocumentData, type DocumentReference, type DocumentSnapshot, type FirestoreError, type Query, type QuerySnapshot, type SnapshotListenOptions } from 'firebase/firestore';
import { requestRemoteSessionRecovery } from '@/platform/functions-api/firebaseCallableRecovery';
import { requestMembershipResolution } from '@/features/access-household/application/membershipResolutionRecovery';

export {
  Timestamp,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  limit,
  orderBy,
  startAfter,
  documentId,
  query,
  where,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore';

export { db } from '@/lib/firebase';

/** Listener 종료 뒤 필요한 권한/인증 복구만 요청하고 원래 오류를 전달한다. */
function listenerError(onError?: (error: FirestoreError) => void) {
  return (error: FirestoreError) => {
    if (!requestMembershipResolution(error)
      && (error.code === 'unauthenticated' || String(error.code) === 'firestore/unauthenticated')) {
      requestRemoteSessionRecovery();
    }
    onError?.(error);
  };
}

export function onSnapshot<App extends DocumentData, Stored extends DocumentData>(
  query: Query<App, Stored>,
  options: SnapshotListenOptions,
  next: (snapshot: QuerySnapshot<App, Stored>) => void,
  onError?: (error: FirestoreError) => void,
): () => void {
  return firebaseOnSnapshot(query, options, next, listenerError(onError));
}

export function onDocumentSnapshot<App extends DocumentData, Stored extends DocumentData>(
  document: DocumentReference<App, Stored>,
  options: SnapshotListenOptions,
  next: (snapshot: DocumentSnapshot<App, Stored>) => void,
  onError?: (error: FirestoreError) => void,
): () => void {
  return firebaseOnSnapshot(document, options, next, listenerError(onError));
}

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

/**
 * 단발 서버 조회 전용 경계입니다. Lite는 Auth와 Rules를 그대로 사용하면서
 * realtime SDK의 IndexedDB 반영을 기다리지 않습니다. Query/reference는 이
 * 경계의 API끼리만 조합하며, 실시간 구독은 firestoreReadModel에 남깁니다.
 */
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore/lite';
import { app } from '@/lib/firebaseApp';
import { firebaseEmulatorHosts, shouldConnectFirebaseEmulators } from '@/platform/firebase/firebaseEmulatorConfig';

export {
  collection,
  query,
  where,
  limit,
  orderBy,
  startAfter,
  documentId,
  getDocs as getDocsFromServer,
  type DocumentData,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore/lite';

// The same FirebaseApp provides the existing Auth session. Lite registers a
// separate Firestore service and does not alter the realtime instance's cache.
export const db = getFirestore(app);

if (shouldConnectFirebaseEmulators()) {
  const runtime = globalThis as typeof globalThis & {
    __householdAccountFirebaseEmulators?: { firestoreServer?: boolean };
  };
  const state = runtime.__householdAccountFirebaseEmulators ??= {};
  if (!state.firestoreServer) {
    connectFirestoreEmulator(db, firebaseEmulatorHosts.firestore.host, firebaseEmulatorHosts.firestore.port);
    state.firestoreServer = true;
  }
}

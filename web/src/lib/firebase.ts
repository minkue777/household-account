import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { isAndroidHostAvailable } from '@/platform/android-host/androidHostBridge';
import { app } from './firebaseApp';

function createFirestore() {
  // Android WebView의 IndexedDB Firestore cache가 장시간 백그라운드 복귀 뒤
  // cache-only 상태로 고착되면 앱 데이터 전체가 갱신되지 않습니다. 첫 화면은
  // 별도의 마지막 검증 localStorage snapshot으로 이미 복원하므로 Android에서는
  // 재구축 가능한 메모리 cache를 사용해 매 프로세스마다 원격 연결을 새로 엽니다.
  if (typeof window !== 'undefined') {
    try {
      return initializeFirestore(app, {
        localCache: isAndroidHostAvailable()
          ? memoryLocalCache()
          : persistentLocalCache({
              tabManager: persistentMultipleTabManager(),
            }),
      });
    } catch {
      // HMR 등으로 이미 초기화된 경우 기존 instance를 재사용합니다.
    }
  }
  return getFirestore(app);
}

const db = createFirestore();

export { app, db };

import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  persistentSingleTabManager,
} from 'firebase/firestore';
import { isAndroidHostAvailable } from '@/platform/android-host/androidHostBridge';
import { app } from './firebaseApp';

function createFirestore() {
  // Android WebView는 한 화면만 소유하므로 IndexedDB read cache를 사용합니다.
  // 재실행 시 월 원장과 가구 read model을 네트워크 응답 전에 표시할 수 있습니다.
  if (typeof window !== 'undefined') {
    try {
      return initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: isAndroidHostAvailable()
            ? persistentSingleTabManager(undefined)
            : persistentMultipleTabManager(),
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

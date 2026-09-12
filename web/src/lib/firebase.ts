import {
  getFirestore,
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { isAndroidHostAvailable } from '@/platform/android-host/androidHostBridge';
import {
  firebaseEmulatorHosts,
  shouldConnectFirebaseEmulators,
} from '@/platform/firebase/firebaseEmulatorConfig';
import { app } from './firebaseApp';
import { Platform } from './utils/platform';

interface FirebaseEmulatorConnectionState {
  firestore?: boolean;
}

function emulatorConnectionState(): FirebaseEmulatorConnectionState {
  const runtime = globalThis as typeof globalThis & {
    __householdAccountFirebaseEmulators?: FirebaseEmulatorConnectionState;
  };
  runtime.__householdAccountFirebaseEmulators ??= {};
  return runtime.__householdAccountFirebaseEmulators;
}

function createFirestore() {
  // 모바일 앱은 첫 서버 snapshot부터 표시합니다. IndexedDB의 이전 실행
  // primary lease와 저장소 작업을 기다리지 않도록 memory cache를 사용합니다.
  // iPhone PWA는 WebKit이 열린 stream의 완료 신호를 보류하는 문제를 피하도록
  // 서버가 데이터를 보낸 뒤 응답을 닫는 long-polling을 사용합니다.
  // https://github.com/firebase/firebase-js-sdk/issues/9789
  if (typeof window !== 'undefined') {
    try {
      const isIOSPWA = Platform.isIOSPWA();
      return initializeFirestore(app, {
        ...(isIOSPWA ? { experimentalForceLongPolling: true } : {}),
        localCache: isAndroidHostAvailable() || isIOSPWA
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

if (shouldConnectFirebaseEmulators()) {
  const state = emulatorConnectionState();
  if (!state.firestore) {
    connectFirestoreEmulator(
      db,
      firebaseEmulatorHosts.firestore.host,
      firebaseEmulatorHosts.firestore.port
    );
    state.firestore = true;
  }
}

export { app, db };

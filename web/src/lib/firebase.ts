import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from 'firebase/firestore';
import { isAndroidHostAvailable } from '@/platform/android-host/androidHostBridge';

const firebaseConfig = {
  apiKey: "AIzaSyCyjcqLX9Gs-yIghFsq9v-vC6K91ZhMuYM",
  authDomain: "household-account-6f300.firebaseapp.com",
  projectId: "household-account-6f300",
  storageBucket: "household-account-6f300.firebasestorage.app",
  messagingSenderId: "530451947649",
  appId: "1:530451947649:web:b5630cc4326eaddbbfad80",
  measurementId: "G-P93WXQT9WT"
};

// Initialize Firebase (prevent re-initialization)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

function createFirestore() {
  // Android WebView는 한 화면만 소유하므로 IndexedDB read cache를 사용합니다.
  // 재실행 시 월 원장과 가구 read model을 네트워크 응답 전에 표시할 수 있습니다.
  if (typeof window !== 'undefined' && isAndroidHostAvailable()) {
    try {
      return initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentSingleTabManager(undefined),
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

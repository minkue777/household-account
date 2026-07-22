import {
  getAuth,
  initializeAuth,
  inMemoryPersistence,
  signInWithPopup,
  signInWithCustomToken,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { app } from './firebase';
import {
  isAndroidHostAvailable,
  requestAndroidHost,
} from '@/platform/android-host/androidHostBridge';

function createAuth() {
  if (!isAndroidHostAvailable()) return getAuth(app);
  try {
    // Android native 인증을 매 실행마다 WebView에 다시 교환하므로 오래된
    // IndexedDB 인증 상태를 WebView의 세션 권위로 사용하지 않습니다.
    return initializeAuth(app, { persistence: inMemoryPersistence });
  } catch {
    return getAuth(app);
  }
}

const auth = createAuth();
const googleProvider = new GoogleAuthProvider();

async function signInFromAndroidHost(): Promise<User> {
  const { customToken } = await requestAndroidHost('auth.sign-in', {});
  const result = await signInWithCustomToken(auth, customToken);
  return result.user;
}

/** Android native Firebase 세션을 WebView의 메모리 인증 세션으로 교환합니다. */
export async function restoreAndroidHostAuth(): Promise<User | null> {
  return isAndroidHostAvailable() ? signInFromAndroidHost() : null;
}

/**
 * 구글 로그인
 */
export async function signInWithGoogle(): Promise<User | null> {
  try {
    if (isAndroidHostAvailable()) {
      return await signInFromAndroidHost();
    }
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    return null;
  }
}

/**
 * 로그아웃
 */
export async function logOut(): Promise<void> {
  if (isAndroidHostAvailable()) {
    await requestAndroidHost('auth.sign-out', {});
  }
  await signOut(auth);
}

/**
 * 현재 사용자 가져오기
 */
export function getCurrentUser(): User | null {
  return auth.currentUser;
}

/**
 * 인증 상태 변경 구독
 */
export function onAuthChange(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

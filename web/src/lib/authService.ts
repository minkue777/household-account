import {
  getAuth,
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

const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();


/**
 * 구글 로그인
 */
export async function signInWithGoogle(): Promise<User | null> {
  try {
    if (isAndroidHostAvailable()) {
      const { customToken } = await requestAndroidHost('auth.sign-in', {});
      const result = await signInWithCustomToken(auth, customToken);
      return result.user;
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

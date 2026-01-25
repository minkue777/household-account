import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { app } from './firebase';

const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// 허용된 관리자 이메일 (여러 개 가능)
const ALLOWED_ADMIN_EMAILS = [
  'minkue777@gmail.com', // 본인 이메일로 변경하세요
];

/**
 * 구글 로그인
 */
export async function signInWithGoogle(): Promise<User | null> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error('Google 로그인 실패:', error);
    return null;
  }
}

/**
 * 로그아웃
 */
export async function logOut(): Promise<void> {
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

/**
 * 관리자 권한 확인
 */
export function isAdmin(user: User | null): boolean {
  if (!user || !user.email) return false;
  return ALLOWED_ADMIN_EMAILS.includes(user.email);
}

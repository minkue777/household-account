import {
  getAuth,
  initializeAuth,
  browserLocalPersistence,
  signInWithPopup,
  signInWithCustomToken,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { app } from './firebaseApp';
import {
  type AndroidSignedInUserResolution,
  isAndroidHostAvailable,
  requestAndroidHost,
} from '@/platform/android-host/androidHostBridge';

export interface AuthenticatedWebSession {
  user: User;
  signedInUserResolution?: AndroidSignedInUserResolution;
}

function createAuth() {
  if (!isAndroidHostAvailable()) return getAuth(app);
  try {
    // 검증된 WebView 세션을 영속화하여 앱 프로세스 재시작마다 custom-token
    // 교환을 첫 화면의 선행 조건으로 반복하지 않습니다. Native 세션 검증은
    // 백그라운드에서 계속 수행하고 실제 권한은 서버 rules가 확인합니다.
    return initializeAuth(app, { persistence: browserLocalPersistence });
  } catch {
    return getAuth(app);
  }
}

const auth = createAuth();
const googleProvider = new GoogleAuthProvider();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSignedInUserResolution(value: unknown): AndroidSignedInUserResolution | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'first-visit-required') {
    if (
      !Array.isArray(value.choices)
      || value.choices.length !== 2
      || !value.choices.includes('create')
      || !value.choices.includes('join')
    ) {
      return null;
    }
    return { kind: 'first-visit-required', choices: ['create', 'join'] };
  }
  if (value.kind !== 'membership-found' || !isRecord(value.membership)) return null;
  const membership = value.membership;
  if (
    typeof membership.householdId !== 'string'
    || membership.householdId.trim() === ''
    || typeof membership.memberId !== 'string'
    || membership.memberId.trim() === ''
    || typeof membership.displayName !== 'string'
    || membership.displayName.trim() === ''
    || typeof membership.aggregateVersion !== 'number'
    || !Number.isInteger(membership.aggregateVersion)
    || membership.aggregateVersion < 1
    || membership.status !== 'active'
    || !Array.isArray(membership.capabilities)
    || membership.capabilities.some((capability) => typeof capability !== 'string')
  ) {
    return null;
  }
  return {
    kind: 'membership-found',
    membership: {
      householdId: membership.householdId,
      memberId: membership.memberId,
      displayName: membership.displayName,
      aggregateVersion: membership.aggregateVersion,
      status: 'active',
      capabilities: membership.capabilities as string[],
    },
  };
}

async function signInFromAndroidHost(): Promise<AuthenticatedWebSession> {
  const response = await requestAndroidHost('auth.sign-in', {});
  const result = await signInWithCustomToken(auth, response.customToken);
  const hasPrincipal = typeof response.principalUid === 'string';
  const hasResolution = response.signedInUserResolution !== undefined;
  if (!hasPrincipal && !hasResolution) {
    // 구버전 Function 응답은 HouseholdContext의 기존 Membership Command로 fallback합니다.
    return { user: result.user };
  }

  const resolution = parseSignedInUserResolution(response.signedInUserResolution);
  if (
    !hasPrincipal
    || response.principalUid !== result.user.uid
    || resolution === null
  ) {
    await signOut(auth).catch(() => {});
    throw new Error('Android 인증 세션과 Membership 해석 결과가 일치하지 않습니다.');
  }
  return { user: result.user, signedInUserResolution: resolution };
}

/** Android native Firebase 세션을 WebView의 메모리 인증 세션으로 교환합니다. */
export async function restoreAndroidHostAuth(): Promise<AuthenticatedWebSession | null> {
  return isAndroidHostAvailable() ? signInFromAndroidHost() : null;
}

/** 로그인과 함께 서버가 같은 Principal에서 확정한 Membership 해석 결과를 반환합니다. */
export async function signInWithGoogleSession(): Promise<AuthenticatedWebSession | null> {
  try {
    if (isAndroidHostAvailable()) {
      return await signInFromAndroidHost();
    }
    const result = await signInWithPopup(auth, googleProvider);
    return { user: result.user };
  } catch (error) {
    return null;
  }
}

/**
 * 구글 로그인
 */
export async function signInWithGoogle(): Promise<User | null> {
  return (await signInWithGoogleSession())?.user ?? null;
}

/**
 * 로그아웃
 */
export async function logOut(): Promise<void> {
  let logoutError: unknown;
  if (isAndroidHostAvailable()) {
    try {
      await requestAndroidHost('auth.sign-out', {});
    } catch (error) {
      logoutError = error;
    }
  }
  try {
    await signOut(auth);
  } catch (error) {
    logoutError ??= error;
  }
  if (logoutError) throw logoutError;
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

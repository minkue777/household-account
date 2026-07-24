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

const HOME_SUMMARY_CARD_KEYS = new Set([
  'localCurrencyBalance',
  'monthlyRemainingBudget',
  'monthlySpent',
  'yearlySpent',
]);

function parseHouseholdView(
  value: unknown
): Extract<AndroidSignedInUserResolution, { kind: 'membership-found' }>['household'] {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || value.id.trim() === ''
    || typeof value.name !== 'string'
    || typeof value.createdAt !== 'string'
    || Number.isNaN(Date.parse(value.createdAt))
    || !Array.isArray(value.members)
  ) {
    return undefined;
  }
  const members = value.members.map((candidate) => {
    if (
      !isRecord(candidate)
      || typeof candidate.id !== 'string'
      || candidate.id.trim() === ''
      || typeof candidate.name !== 'string'
      || !Number.isInteger(candidate.aggregateVersion)
      || Number(candidate.aggregateVersion) < 1
    ) {
      return undefined;
    }
    return {
      id: candidate.id,
      name: candidate.name,
      aggregateVersion: Number(candidate.aggregateVersion),
    };
  });
  if (members.some((member) => member === undefined)) return undefined;

  const rawSummary = value.homeSummaryConfig;
  const homeSummaryConfig =
    isRecord(rawSummary)
    && HOME_SUMMARY_CARD_KEYS.has(String(rawSummary.leftCard))
    && HOME_SUMMARY_CARD_KEYS.has(String(rawSummary.rightCard))
      ? {
          leftCard: String(rawSummary.leftCard),
          rightCard: String(rawSummary.rightCard),
        }
      : undefined;
  return {
    id: value.id,
    name: value.name,
    createdAt: new Date(value.createdAt).toISOString(),
    ...(typeof value.defaultCategoryKey === 'string'
      ? { defaultCategoryKey: value.defaultCategoryKey }
      : {}),
    ...(homeSummaryConfig ? { homeSummaryConfig } : {}),
    members: members as NonNullable<
      Extract<AndroidSignedInUserResolution, { kind: 'membership-found' }>['household']
    >['members'],
  };
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
  const household = parseHouseholdView(value.household);
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
    ...(household ? { household } : {}),
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

/**
 * Android WebView의 영속 Web Auth 토큰을 서버에서 다시 검증합니다.
 * Web refresh token이 더 이상 유효하지 않을 때만 Native 세션으로 교환합니다.
 */
export async function refreshAndroidWebAuth(
  existingUser: User
): Promise<AuthenticatedWebSession> {
  try {
    await existingUser.getIdToken(true);
    return { user: existingUser };
  } catch {
    const restored = await restoreAndroidHostAuth();
    if (!restored) throw new Error('ANDROID_AUTH_RESTORE_REQUIRED');
    return restored;
  }
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

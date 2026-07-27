import { isAndroidHostAvailable } from '@/platform/android-host/androidHostBridge';

export const REMOTE_SESSION_RECOVERED_EVENT =
  'household-account:remote-session-recovered';
export const REMOTE_SESSION_RECOVERY_REQUESTED_EVENT =
  'household-account:remote-session-recovery-requested';

let lastRecoveryRequestAt = 0;

export function requestRemoteSessionRecovery(): void {
  if (
    typeof window === 'undefined'
    || !isAndroidHostAvailable()
    || Date.now() - lastRecoveryRequestAt < 30_000
  ) {
    return;
  }
  lastRecoveryRequestAt = Date.now();
  window.dispatchEvent(new Event(REMOTE_SESSION_RECOVERY_REQUESTED_EVENT));
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return String((error as { code: unknown }).code);
}

function isAuthenticationFailure(error: unknown): boolean {
  return errorCode(error) === 'functions/unauthenticated';
}

async function recoverAndroidFirebaseSession(): Promise<void> {
  const {
    getCurrentUser,
    refreshAndroidWebAuth,
    restoreAndroidHostAuth,
  } = await import('@/lib/authService');

  const currentUser = getCurrentUser();
  const session = currentUser
    ? await refreshAndroidWebAuth(currentUser)
    : await restoreAndroidHostAuth();
  if (!session?.user) throw new Error('ANDROID_AUTH_RESTORE_REQUIRED');

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(REMOTE_SESSION_RECOVERED_EVENT));
  }
}

/**
 * Callable 인증이 만료된 Android WebView만 Native 세션으로 한 번 복구한 뒤
 * 같은 envelope를 재전송합니다. Command envelope는 고정 idempotency key를
 * 유지하므로 응답 유실 뒤 재시도도 중복 업무를 만들지 않습니다.
 */
export async function withFirebaseCallableRecovery<T>(
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isAndroidHostAvailable() || !isAuthenticationFailure(error)) throw error;
    await recoverAndroidFirebaseSession();
    return operation();
  }
}

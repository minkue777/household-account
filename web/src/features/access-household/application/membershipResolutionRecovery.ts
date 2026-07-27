export const MEMBERSHIP_RESOLUTION_REQUESTED_EVENT =
  'household-account:membership-resolution-requested';

const REQUEST_THROTTLE_MS = 30_000;
let lastRequestAt = Number.NEGATIVE_INFINITY;
let trailingRequestId: number | undefined;

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return String((error as { code: unknown }).code);
}

export function isMembershipAuthorizationFailure(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'permission-denied'
    || code === 'firestore/permission-denied';
}

export function requestAuthoritativeMembershipResolution(): void {
  if (typeof window === 'undefined') return;

  const remainingThrottle =
    REQUEST_THROTTLE_MS - (Date.now() - lastRequestAt);
  if (remainingThrottle > 0) {
    if (trailingRequestId === undefined) {
      trailingRequestId = window.setTimeout(() => {
        trailingRequestId = undefined;
        lastRequestAt = Date.now();
        window.dispatchEvent(new Event(MEMBERSHIP_RESOLUTION_REQUESTED_EVENT));
      }, remainingThrottle);
    }
    return;
  }

  if (trailingRequestId !== undefined) {
    window.clearTimeout(trailingRequestId);
    trailingRequestId = undefined;
  }
  lastRequestAt = Date.now();
  window.dispatchEvent(new Event(MEMBERSHIP_RESOLUTION_REQUESTED_EVENT));
}

/** 현재 coordinator가 복구 신호를 인수했거나 완료했을 때 중복 trailing 신호만 제거합니다. */
export function cancelQueuedAuthoritativeMembershipResolution(): void {
  if (typeof window === 'undefined' || trailingRequestId === undefined) return;
  window.clearTimeout(trailingRequestId);
  trailingRequestId = undefined;
}

/**
 * Firestore가 저장된 가구 scope를 거부했을 때만 authoritative Membership을 다시 찾습니다.
 * 네트워크 오류나 정상 앱 실행을 주기적 재검증으로 확대하지 않습니다.
 */
export function requestMembershipResolution(error: unknown): boolean {
  if (!isMembershipAuthorizationFailure(error)) return false;
  requestAuthoritativeMembershipResolution();
  return true;
}

import {
  cancelQueuedAuthoritativeMembershipResolution,
  MEMBERSHIP_RESOLUTION_REQUESTED_EVENT,
  isMembershipAuthorizationFailure,
  requestMembershipResolution,
} from '@/features/access-household/application/membershipResolutionRecovery';

describe('Membership 권한 오류 복구 계약', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('Firestore permission-denied만 Membership 재해석 대상으로 분류한다', () => {
    expect(isMembershipAuthorizationFailure({ code: 'permission-denied' })).toBe(true);
    expect(isMembershipAuthorizationFailure({
      code: 'firestore/permission-denied',
    })).toBe(true);
    expect(isMembershipAuthorizationFailure({ code: 'unavailable' })).toBe(false);
    expect(isMembershipAuthorizationFailure({
      code: 'functions/permission-denied',
    })).toBe(false);
  });

  it('권한 거부 때만 복구 이벤트를 내보내고 연속 오류는 하나로 합친다', () => {
    let now = 100_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const listener = jest.fn();
    window.addEventListener(MEMBERSHIP_RESOLUTION_REQUESTED_EVENT, listener);

    requestMembershipResolution({ code: 'unavailable' });
    requestMembershipResolution({ code: 'firestore/permission-denied' });
    requestMembershipResolution({ code: 'firestore/permission-denied' });
    expect(listener).toHaveBeenCalledTimes(1);

    now += 30_001;
    requestMembershipResolution({ code: 'permission-denied' });
    expect(listener).toHaveBeenCalledTimes(2);

    window.removeEventListener(MEMBERSHIP_RESOLUTION_REQUESTED_EVENT, listener);
  });

  it('cooldown 중 다시 거부되면 이벤트를 버리지 않고 마지막 한 번을 지연 전달한다', () => {
    jest.useFakeTimers();
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const listener = jest.fn();
    window.addEventListener(MEMBERSHIP_RESOLUTION_REQUESTED_EVENT, listener);

    requestMembershipResolution({ code: 'permission-denied' });
    requestMembershipResolution({ code: 'permission-denied' });
    requestMembershipResolution({ code: 'permission-denied' });
    expect(listener).toHaveBeenCalledTimes(1);

    now += 30_000;
    jest.advanceTimersByTime(30_000);
    expect(listener).toHaveBeenCalledTimes(2);

    window.removeEventListener(MEMBERSHIP_RESOLUTION_REQUESTED_EVENT, listener);
  });

  it('coordinator가 복구를 인수하면 같은 오류 묶음의 trailing 이벤트를 취소한다', () => {
    jest.useFakeTimers();
    let now = 2_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const listener = jest.fn();
    window.addEventListener(MEMBERSHIP_RESOLUTION_REQUESTED_EVENT, listener);

    requestMembershipResolution({ code: 'permission-denied' });
    requestMembershipResolution({ code: 'permission-denied' });
    expect(listener).toHaveBeenCalledTimes(1);

    cancelQueuedAuthoritativeMembershipResolution();
    now += 30_000;
    jest.advanceTimersByTime(30_000);
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(MEMBERSHIP_RESOLUTION_REQUESTED_EVENT, listener);
  });
});

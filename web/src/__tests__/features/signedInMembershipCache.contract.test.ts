import {
  SIGNED_IN_MEMBERSHIP_REVALIDATION_INTERVAL_MS,
  clearSignedInMembershipCache,
  getSignedInMembershipRevalidationDelay,
  invalidateSignedInMembershipVerification,
  readSignedInMembershipCache,
  writeSignedInMembershipCache,
} from '@/features/access-household/application/signedInMembershipCache';

const resolution = {
  kind: 'membership-found' as const,
  membership: {
    householdId: 'household-1',
    memberId: 'member-1',
    displayName: '민규',
    aggregateVersion: 3,
    status: 'active' as const,
    capabilities: ['household.read'],
  },
};

describe('로그인 Membership cache 계약', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.spyOn(Date, 'now').mockReturnValue(10_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('화면 데이터 없이 UID에 귀속된 Membership 연결 정보만 저장한다', () => {
    writeSignedInMembershipCache('uid-1', resolution);

    expect(readSignedInMembershipCache('uid-1')).toEqual(resolution);
    expect(readSignedInMembershipCache('uid-2')).toBeUndefined();
    expect(JSON.parse(
      window.localStorage.getItem('household-account.signed-in-membership.v1') ?? '{}'
    )).toEqual({
      version: 4,
      principalUid: 'uid-1',
      resolution,
      verifiedAt: 10_000,
    });
  });

  it('기존 화면 snapshot이 들어 있는 저장값도 Membership만 읽고 다음 저장에서 화면 데이터를 제거한다', () => {
    window.localStorage.setItem(
      'household-account.signed-in-membership.v1',
      JSON.stringify({
        version: 3,
        principalUid: 'uid-1',
        resolution,
        verifiedAt: 9_000,
        household: {
          id: 'household-1',
          name: '이전 가계부',
          createdAt: '2026-07-20T00:00:00.000Z',
          members: [{ id: 'member-1', name: '민규', aggregateVersion: 3 }],
        },
      })
    );

    expect(readSignedInMembershipCache('uid-1')).toEqual(resolution);
    writeSignedInMembershipCache(
      'uid-1',
      resolution,
      { preserveVerificationTime: true }
    );

    const stored = JSON.parse(
      window.localStorage.getItem('household-account.signed-in-membership.v1') ?? '{}'
    );
    expect(stored.version).toBe(4);
    expect(stored.verifiedAt).toBe(9_000);
    expect(stored).not.toHaveProperty('household');
  });

  it('검증 주기와 명시적 무효화는 화면 cache 없이 Membership에만 적용한다', () => {
    writeSignedInMembershipCache('uid-1', resolution);

    expect(getSignedInMembershipRevalidationDelay('uid-1', 10_000)).toBe(
      SIGNED_IN_MEMBERSHIP_REVALIDATION_INTERVAL_MS
    );
    invalidateSignedInMembershipVerification('uid-1');
    expect(getSignedInMembershipRevalidationDelay('uid-1', 10_000)).toBe(0);
  });

  it('로그아웃 시 Membership 연결 정보도 제거한다', () => {
    writeSignedInMembershipCache('uid-1', resolution);
    clearSignedInMembershipCache();
    expect(readSignedInMembershipCache('uid-1')).toBeUndefined();
  });
});

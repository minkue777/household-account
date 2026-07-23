import {
  clearSignedInMembershipCache,
  getSignedInMembershipRevalidationDelay,
  invalidateSignedInMembershipVerification,
  readLastSignedInSessionCache,
  readSignedInHouseholdCache,
  readSignedInMembershipCache,
  SIGNED_IN_MEMBERSHIP_REVALIDATION_INTERVAL_MS,
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

describe('signed-in Membership cache contract', () => {
  beforeEach(() => window.localStorage.clear());

  it('동일 Firebase principal만 마지막 검증 Membership을 재사용한다', () => {
    writeSignedInMembershipCache('uid-1', resolution);

    expect(readSignedInMembershipCache('uid-1')).toEqual(resolution);
    expect(readSignedInMembershipCache('uid-other')).toBeUndefined();
  });

  it('손상된 값은 사용하지 않고 로그아웃 시 제거한다', () => {
    window.localStorage.setItem(
      'household-account.signed-in-membership.v1',
      JSON.stringify({ version: 1, principalUid: 'uid-1', resolution: {} })
    );
    expect(readSignedInMembershipCache('uid-1')).toBeUndefined();

    writeSignedInMembershipCache('uid-1', resolution);
    clearSignedInMembershipCache();
    expect(readSignedInMembershipCache('uid-1')).toBeUndefined();
  });

  it('동일 principal의 마지막 가구 화면을 동기식으로 복원한다', () => {
    const household = {
      id: 'household-1',
      name: '즉시 표시 가계부',
      createdAt: new Date('2026-07-23T00:00:00+09:00'),
      defaultCategoryKey: '기타',
      members: [{ id: 'member-1', name: '민규', aggregateVersion: 3 }],
    };

    writeSignedInMembershipCache('uid-1', resolution, household);

    expect(readSignedInHouseholdCache('uid-1', 'household-1')).toEqual(household);
    expect(readSignedInHouseholdCache('uid-other', 'household-1')).toBeUndefined();
    expect(readSignedInHouseholdCache('uid-1', 'household-other')).toBeUndefined();
  });

  it('Membership만 갱신해도 같은 가구의 화면 snapshot은 유지한다', () => {
    const household = {
      id: 'household-1',
      name: '보존 가계부',
      createdAt: new Date('2026-07-23T00:00:00+09:00'),
      members: [{ id: 'member-1', name: '민규', aggregateVersion: 3 }],
    };
    writeSignedInMembershipCache('uid-1', resolution, household);
    writeSignedInMembershipCache('uid-1', {
      ...resolution,
      membership: { ...resolution.membership, aggregateVersion: 4 },
    });

    expect(readSignedInHouseholdCache('uid-1', 'household-1')?.name).toBe('보존 가계부');
  });

  it('complete last session can be restored before Firebase Auth persistence resolves', () => {
    const household = {
      id: 'household-1',
      name: '즉시 표시 가계부',
      createdAt: new Date('2026-07-23T00:00:00+09:00'),
      members: [{ id: 'member-1', name: '민규', aggregateVersion: 3 }],
    };
    writeSignedInMembershipCache('uid-1', resolution, household);

    expect(readLastSignedInSessionCache()).toEqual({
      principalUid: 'uid-1',
      resolution,
      household,
    });
  });

  it('최근 검증한 같은 principal은 주기 안에서 Membership 재검증을 생략한다', () => {
    const verifiedAt = 1_000_000;
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(verifiedAt);
    writeSignedInMembershipCache('uid-1', resolution);

    expect(getSignedInMembershipRevalidationDelay('uid-1', verifiedAt)).toBe(
      SIGNED_IN_MEMBERSHIP_REVALIDATION_INTERVAL_MS
    );
    expect(getSignedInMembershipRevalidationDelay('uid-other', verifiedAt)).toBeUndefined();
    dateNow.mockRestore();
  });

  it('cache 화면 갱신은 마지막 권위 검증 시각을 연장하지 않는다', () => {
    const verifiedAt = 1_000_000;
    const elapsed = 5 * 60 * 1_000;
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(verifiedAt);
    writeSignedInMembershipCache('uid-1', resolution);

    dateNow.mockReturnValue(verifiedAt + elapsed);
    writeSignedInMembershipCache(
      'uid-1',
      resolution,
      undefined,
      { preserveVerificationTime: true }
    );

    expect(
      getSignedInMembershipRevalidationDelay('uid-1', verifiedAt + elapsed)
    ).toBe(SIGNED_IN_MEMBERSHIP_REVALIDATION_INTERVAL_MS - elapsed);
    dateNow.mockRestore();
  });

  it('검증 시각이 없는 기존 cache는 첫 paint 뒤 background 재검증 대상이다', () => {
    writeSignedInMembershipCache('uid-1', resolution);
    const stored = JSON.parse(
      window.localStorage.getItem('household-account.signed-in-membership.v1') ?? '{}'
    );
    stored.version = 2;
    delete stored.verifiedAt;
    window.localStorage.setItem(
      'household-account.signed-in-membership.v1',
      JSON.stringify(stored)
    );

    expect(getSignedInMembershipRevalidationDelay('uid-1')).toBe(0);
  });

  it('권한 read가 거절되면 화면 snapshot은 남기고 Membership 재검증만 앞당긴다', () => {
    const household = {
      id: 'household-1',
      name: '마지막 화면',
      createdAt: new Date('2026-07-23T00:00:00+09:00'),
      members: [{ id: 'member-1', name: '민규', aggregateVersion: 3 }],
    };
    writeSignedInMembershipCache('uid-1', resolution, household);

    invalidateSignedInMembershipVerification('uid-1');

    expect(getSignedInMembershipRevalidationDelay('uid-1')).toBe(0);
    expect(readSignedInHouseholdCache('uid-1', 'household-1')).toEqual(household);
  });
});

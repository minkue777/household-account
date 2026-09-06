import {
  clearSignedInMembershipCache,
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

const resolutionWithHousehold: Parameters<typeof writeSignedInMembershipCache>[1] = {
  ...resolution,
  household: {
    id: 'household-1',
    name: '저장된 가계부',
    createdAt: '2026-07-20T00:00:00.000Z',
    defaultCategoryKey: '생활',
    categoryCatalogVersion: 5,
    homeSummaryConfigVersion: 7,
    selectedLocalCurrencyType: '서울페이',
    initializationStatus: 'completed',
    homeSummaryConfig: {
      leftCard: 'monthlyRemainingBudget',
      rightCard: 'monthlySpent',
    },
    members: [{ id: 'member-1', name: '민규', aggregateVersion: 3 }],
  },
};

describe('로그인 Membership cache 계약', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('구형 가구 metadata의 누락 version은 0으로 읽고 사용자 선택을 추정하지 않는다', () => {
    const { categoryCatalogVersion: _category, homeSummaryConfigVersion: _home, selectedLocalCurrencyType: _selection,
      ...legacyHousehold } = resolutionWithHousehold.household!;
    writeSignedInMembershipCache('uid-1', { ...resolution, household: legacyHousehold });
    expect(readSignedInMembershipCache('uid-1')?.household).toEqual({
      ...legacyHousehold, categoryCatalogVersion: 0, homeSummaryConfigVersion: 0,
    });
  });

  it('UID에 귀속된 Membership scope와 가구 표시 설정만 저장한다', () => {
    writeSignedInMembershipCache('uid-1', resolutionWithHousehold);

    expect(readSignedInMembershipCache('uid-1')).toEqual(resolutionWithHousehold);
    expect(readSignedInMembershipCache('uid-2')).toBeUndefined();
    expect(JSON.parse(
      window.localStorage.getItem('household-account.signed-in-membership.v1') ?? '{}'
    )).toEqual(expect.objectContaining({
      version: 5,
      principalUid: 'uid-1',
      resolution: resolutionWithHousehold,
    }));
  });

  it('기존 검증 시각과 화면 snapshot은 읽기 호환 후 다음 저장에서 제거한다', () => {
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
    writeSignedInMembershipCache('uid-1', resolution);

    const stored = JSON.parse(
      window.localStorage.getItem('household-account.signed-in-membership.v1') ?? '{}'
    );
    expect(stored.version).toBe(5);
    expect(stored).not.toHaveProperty('verifiedAt');
    expect(stored).not.toHaveProperty('household');
  });

  it('로그아웃 시 Membership 연결 정보도 제거한다', () => {
    writeSignedInMembershipCache('uid-1', resolution);
    clearSignedInMembershipCache();
    expect(readSignedInMembershipCache('uid-1')).toBeUndefined();
  });
});

import {
  clearSignedInMembershipCache,
  readLastSignedInSessionCache,
  readSignedInHouseholdCache,
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
});

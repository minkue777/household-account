import { calculateRealtimeDailyAssetChanges } from '@/features/portfolio/application/dailyAssetChangeSummary';

describe('자산 일간 변동 단일 요약 계산 계약', () => {
  const ownerProfiles = [
    { profileId: 'profile-min', displayName: '민규' },
    { profileId: 'profile-jin', displayName: '진선' },
  ];

  test('[T-PERF-HOLD-002][JOB-AST-002] 전일 요약 한 건과 현재 자산으로 전체 및 모든 명의자의 변동을 함께 계산한다', () => {
    const result = calculateRealtimeDailyAssetChanges({
      ownerProfiles,
      assets: [
        {
          type: 'savings',
          currentBalance: 800,
          ownerRef: { kind: 'profile', profileId: 'profile-min' },
        },
        {
          type: 'loan',
          currentBalance: 100,
          ownerRef: { kind: 'profile', profileId: 'profile-min' },
        },
        {
          type: 'stock',
          currentBalance: 300,
          ownerRef: { kind: 'profile', profileId: 'profile-jin' },
        },
      ],
      previous: {
        localDate: '2026-07-27',
        total: 900,
        byOwnerRefKey: {
          'profile:profile-min': 650,
          'profile:profile-jin': 250,
        },
      },
    });

    expect(result).toEqual({
      total: 100,
      byProfileId: {
        'profile-min': 50,
        'profile-jin': 50,
      },
    });
  });

  test('ownerRef가 없는 과거 자산은 명의자 표시 이름으로 안정 ID에 연결한다', () => {
    const result = calculateRealtimeDailyAssetChanges({
      ownerProfiles,
      assets: [
        {
          type: 'savings',
          currentBalance: 1_100,
          owner: '진선',
        },
      ],
      previous: {
        localDate: '2026-07-27',
        total: 1_000,
        byOwnerRefKey: {
          'profile:profile-jin': 1_000,
        },
      },
    });

    expect(result.total).toBe(100);
    expect(result.byProfileId['profile-jin']).toBe(100);
  });

  test('전일 요약이 없거나 전일 명의자 기준값이 없으면 참고 변동을 0으로 둔다', () => {
    expect(
      calculateRealtimeDailyAssetChanges({
        ownerProfiles,
        assets: [
          {
            type: 'stock',
            currentBalance: 300,
            ownerRef: { kind: 'profile', profileId: 'profile-jin' },
          },
        ],
      })
    ).toEqual({
      total: 0,
      byProfileId: {
        'profile-min': 0,
        'profile-jin': 0,
      },
    });

    const missingOwnerBaseline = calculateRealtimeDailyAssetChanges({
      ownerProfiles,
      assets: [
        {
          type: 'stock',
          currentBalance: 300,
          ownerRef: { kind: 'profile', profileId: 'profile-jin' },
        },
      ],
      previous: {
        localDate: '2026-07-27',
        total: 200,
        byOwnerRefKey: {},
      },
    });

    expect(missingOwnerBaseline.total).toBe(100);
    expect(missingOwnerBaseline.byProfileId['profile-jin']).toBe(0);
  });
});

import {
  readAssetOwnerProfileSnapshot,
  readAssetSnapshot,
  writeAssetOwnerProfileSnapshot,
  writeAssetSnapshot,
} from '@/features/portfolio/application/portfolioReadSnapshot';
import type { Asset } from '@/types/asset';

const asset: Asset = {
  id: 'asset-1',
  aggregateVersion: 3,
  householdId: 'house-1',
  name: '예금',
  type: 'savings',
  currentBalance: 10_000,
  currency: 'KRW',
  isActive: true,
  order: 0,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-23T00:00:00.000Z'),
};

describe('portfolio first-paint snapshot contract', () => {
  beforeEach(() => window.localStorage.clear());

  it('자산 날짜와 aggregate version을 보존하여 같은 가구에서 즉시 복원한다', () => {
    writeAssetSnapshot('house-1', [asset]);

    expect(readAssetSnapshot('house-1')).toEqual([asset]);
    expect(readAssetSnapshot('house-2')).toBeUndefined();
  });

  it('명의자 순서와 안정 profile ID를 같은 가구에서 즉시 복원한다', () => {
    const profiles = [
      {
        profileId: 'profile-1',
        householdId: 'house-1',
        displayName: '민규',
        profileType: 'member' as const,
        linkedMemberId: 'member-1',
        lifecycleState: 'active' as const,
        aggregateVersion: 2,
      },
      {
        profileId: 'profile-2',
        householdId: 'house-1',
        displayName: '지아',
        profileType: 'dependent' as const,
        lifecycleState: 'active' as const,
        aggregateVersion: 1,
      },
    ];

    writeAssetOwnerProfileSnapshot('house-1', profiles);

    expect(readAssetOwnerProfileSnapshot('house-1')).toEqual(profiles);
  });

  it('손상되거나 다른 가구의 snapshot은 화면에 사용하지 않는다', () => {
    window.localStorage.setItem(
      'household-account.assets.v1.house-1',
      JSON.stringify({
        version: 1,
        householdId: 'house-1',
        values: [{ ...asset, householdId: 'house-2' }],
      })
    );

    expect(readAssetSnapshot('house-1')).toBeUndefined();
  });
});

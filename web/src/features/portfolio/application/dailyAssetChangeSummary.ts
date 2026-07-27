import type { Asset } from '@/types/asset';
import { getAssetSignedBalance } from '@/lib/assets/assetMath';

export interface PreviousAssetDailySummary {
  readonly localDate: string;
  readonly total: number;
  readonly byOwnerRefKey: Readonly<Record<string, number>>;
}

export interface AssetOwnerIdentity {
  readonly profileId: string;
  readonly displayName: string;
}

export interface RealtimeDailyAssetChanges {
  readonly total: number;
  readonly byProfileId: Readonly<Record<string, number>>;
}

type DailyChangeAsset = Pick<
  Asset,
  'type' | 'currentBalance' | 'owner' | 'ownerRef'
>;

function profileOwnerKey(profileId: string): string {
  return `profile:${profileId}`;
}

function resolveOwnerKey(
  asset: DailyChangeAsset,
  profileIdByDisplayName: ReadonlyMap<string, string>
): string {
  if (asset.ownerRef?.kind === 'profile') {
    return profileOwnerKey(asset.ownerRef.profileId);
  }
  if (asset.ownerRef?.kind === 'household') {
    return 'household';
  }

  const legacyProfileId = asset.owner
    ? profileIdByDisplayName.get(asset.owner)
    : undefined;
  return legacyProfileId === undefined
    ? 'household'
    : profileOwnerKey(legacyProfileId);
}

/**
 * 현재 자산 원본과 전일 Canonical summary의 차이를 계산합니다.
 *
 * Firestore 조회는 이 함수 밖에서 한 번만 수행하며, 전체 및 모든 명의자의
 * 변동액은 같은 입력 snapshot을 기준으로 메모리에서 함께 계산합니다.
 */
export function calculateRealtimeDailyAssetChanges(input: {
  readonly assets: readonly DailyChangeAsset[];
  readonly ownerProfiles: readonly AssetOwnerIdentity[];
  readonly previous?: PreviousAssetDailySummary;
}): RealtimeDailyAssetChanges {
  if (input.previous === undefined) {
    return {
      total: 0,
      byProfileId: Object.fromEntries(
        input.ownerProfiles.map(({ profileId }) => [profileId, 0])
      ),
    };
  }

  const profileIdByDisplayName = new Map(
    input.ownerProfiles.map(({ profileId, displayName }) => [
      displayName,
      profileId,
    ])
  );
  const currentByOwnerRefKey: Record<string, number> = {};
  let currentTotal = 0;

  for (const asset of input.assets) {
    const balance = getAssetSignedBalance(asset);
    const ownerKey = resolveOwnerKey(asset, profileIdByDisplayName);
    currentTotal += balance;
    currentByOwnerRefKey[ownerKey] =
      (currentByOwnerRefKey[ownerKey] ?? 0) + balance;
  }

  return {
    total: currentTotal - input.previous.total,
    byProfileId: Object.fromEntries(
      input.ownerProfiles.map(({ profileId }) => {
        const ownerKey = profileOwnerKey(profileId);
        const previousBalance = input.previous?.byOwnerRefKey[ownerKey];
        return [
          profileId,
          previousBalance === undefined
            ? 0
            : (currentByOwnerRefKey[ownerKey] ?? 0) - previousBalance,
        ];
      })
    ),
  };
}

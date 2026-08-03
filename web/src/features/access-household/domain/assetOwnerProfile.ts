export interface AssetOwnerProfileView {
  profileId: string;
  householdId: string;
  displayName: string;
  profileType: 'member' | 'dependent';
  selectionVisibility: 'visible' | 'hidden';
  linkedMemberId?: string;
  lifecycleState: 'active' | 'archived';
  aggregateVersion: number;
}

export function selectVisibleAssetOwnerProfiles(
  profiles: readonly AssetOwnerProfileView[]
): AssetOwnerProfileView[] {
  return profiles.filter((profile) => profile.selectionVisibility === 'visible');
}

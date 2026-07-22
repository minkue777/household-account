export interface AssetOwnerProfileView {
  profileId: string;
  householdId: string;
  displayName: string;
  profileType: 'member' | 'dependent';
  linkedMemberId?: string;
  lifecycleState: 'active' | 'archived';
  aggregateVersion: number;
}

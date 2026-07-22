import type { AssetOwnerProfileView } from '@/features/access-household/domain/assetOwnerProfile';

export type AssetOwnerProfileWireView = AssetOwnerProfileView;

export interface AdminHouseholdWireView {
  householdId: string;
  name: string;
  createdAt: string;
  lifecycleState: 'active' | 'deleted';
  aggregateVersion: number;
  legacyShareKey?: string;
}

export interface AdminMemberWireView {
  memberId: string;
  displayName: string;
  lifecycleState: 'active' | 'removed';
  aggregateVersion: number;
  linkedPrincipal: boolean;
}

export interface AdminDeletedAssetWireView {
  assetId: string;
  name: string;
  lifecycleState: 'deleted';
  aggregateVersion: number;
  deletedAt?: string;
}

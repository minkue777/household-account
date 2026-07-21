export interface VerifiedProfileActor {
  principalUid: string;
  householdId: string;
  actingMemberId?: string;
  capabilities: readonly (
    | "household.asset-owner-profile.write"
    | "admin.asset-owner-profile.archive"
  )[];
}

export interface AssetOwnerProfileView {
  profileId: string;
  householdId: string;
  displayName: string;
  profileType: "member" | "dependent";
  linkedMemberId?: string;
  lifecycleState: "active" | "archived";
  aggregateVersion: number;
}

export type AssetOwnerProfileCommandResult =
  | { kind: "success"; profile: AssetOwnerProfileView }
  | { kind: "validation-error"; code: string }
  | { kind: "not-found"; resource: "AssetOwnerProfile"; id: string }
  | {
      kind: "conflict";
      code: "MEMBER_PROFILE_IMMUTABLE" | "OWNER_PROFILE_ARCHIVED" | string;
      currentVersion?: number;
    }
  | { kind: "forbidden"; code: string };

export type AssetOwnerProfileListResult =
  | { kind: "success"; profiles: readonly AssetOwnerProfileView[] }
  | { kind: "no-data" }
  | { kind: "forbidden"; code: string };

export type RenameSelfResult =
  | { kind: "success"; memberId: string; displayName: string }
  | { kind: "conflict"; code?: string }
  | { kind: "forbidden"; code?: string }
  | { kind: "validation-error"; code?: string };

export interface AssetOwnerProfileInputPort {
  createAssetOwnerProfile(
    actor: VerifiedProfileActor,
    input: { displayName: string; idempotencyKey: string },
  ): Promise<AssetOwnerProfileCommandResult>;
  renameAssetOwnerProfile(
    actor: VerifiedProfileActor,
    input: {
      profileId: string;
      displayName: string;
      expectedVersion: number;
      idempotencyKey: string;
    },
  ): Promise<AssetOwnerProfileCommandResult>;
  archiveAssetOwnerProfile(
    actor: VerifiedProfileActor,
    input: {
      profileId: string;
      expectedVersion: number;
      idempotencyKey: string;
    },
  ): Promise<AssetOwnerProfileCommandResult>;
  renameSelf(
    actor: VerifiedProfileActor,
    input: {
      displayName: string;
      expectedMemberVersion: number;
      idempotencyKey: string;
    },
  ): Promise<RenameSelfResult>;
  listAssetOwnerProfiles(
    actor: VerifiedProfileActor,
    input: { includeArchived?: boolean },
  ): Promise<AssetOwnerProfileListResult>;
  resolveOwnerProfileForHistory(
    actor: VerifiedProfileActor,
    profileId: string,
  ): Promise<AssetOwnerProfileView | undefined>;
}

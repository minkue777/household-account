import {
  AssetOwnerProfile,
  AssetOwnerProfileChangedEvent,
  AssetOwnerProfileState,
} from "../model/assetOwnerProfile";

export type ProfileNameValidation =
  | { kind: "valid"; displayName: string }
  | { kind: "invalid"; code: "ASSET_OWNER_PROFILE_NAME_REQUIRED" };

export function validateProfileName(displayName: string): ProfileNameValidation {
  const normalized = displayName.trim();
  return normalized.length === 0
    ? { kind: "invalid", code: "ASSET_OWNER_PROFILE_NAME_REQUIRED" }
    : { kind: "valid", displayName: normalized };
}

export function memberHasSingleProfile(
  state: AssetOwnerProfileState,
  memberId: string,
): boolean {
  return (
    state.profiles.filter(
      (profile) =>
        profile.profileType === "member" &&
        profile.linkedMemberId === memberId,
    ).length === 1
  );
}

export function profileChangedEvent(
  profile: AssetOwnerProfile,
  includeDisplayName: boolean,
): AssetOwnerProfileChangedEvent {
  return {
    eventType: "AssetOwnerProfileChanged.v1",
    householdId: profile.householdId,
    payload: {
      profileId: profile.profileId,
      profileType: profile.profileType,
      lifecycleState: profile.lifecycleState,
      ...(includeDisplayName ? { newDisplayName: profile.displayName } : {}),
    },
  };
}

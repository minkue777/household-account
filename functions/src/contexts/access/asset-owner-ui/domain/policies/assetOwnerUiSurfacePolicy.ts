export type AssetOwnerUiSurface =
  | "ordinary-asset-owner-selector"
  | "administrator-owner-management";

export type AssetOwnerUiAction =
  | "create-dependent"
  | "rename-dependent"
  | "select-owner"
  | "archive-dependent";

export function allowedAssetOwnerActions(
  capabilities: readonly string[],
  surface: AssetOwnerUiSurface,
): readonly AssetOwnerUiAction[] {
  if (surface === "ordinary-asset-owner-selector") {
    return capabilities.includes("household.asset-owner-profile.write")
      ? ["create-dependent", "rename-dependent", "select-owner"]
      : [];
  }

  return capabilities.includes("admin.asset-owner-profile.archive")
    ? ["archive-dependent"]
    : [];
}

export interface ActiveOwnerProfileSummary {
  profileId: string;
  displayName: string;
  profileType: "member" | "dependent";
}

export type AssetOwnerSelectorItem =
  | { kind: "all"; key: "all"; label: "전체" }
  | {
      kind: "owner-profile";
      key: string;
      label: string;
      profileId: string;
      profileType: "member" | "dependent";
    }
  | { kind: "add-dependent"; key: "add-dependent"; label: "+" };

export function composeAssetOwnerSelectorItems(
  profiles: readonly ActiveOwnerProfileSummary[],
  canCreateDependent: boolean,
): readonly AssetOwnerSelectorItem[] {
  const ownerItems: AssetOwnerSelectorItem[] = profiles.map((profile) => ({
    kind: "owner-profile",
    key: `profile:${profile.profileId}`,
    label: profile.displayName,
    profileId: profile.profileId,
    profileType: profile.profileType,
  }));

  return [
    { kind: "all", key: "all", label: "전체" },
    ...ownerItems,
    ...(canCreateDependent
      ? ([
          { kind: "add-dependent", key: "add-dependent", label: "+" },
        ] as const)
      : []),
  ];
}

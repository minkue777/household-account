import { createAssetOwnerUiSurfaceApplication } from "../../src/contexts/access/asset-owner-ui/application/assetOwnerUiSurfaceApplication";
import type { ActiveAssetOwnerProfileQueryPort } from "../../src/contexts/access/asset-owner-ui/application/ports/out/activeAssetOwnerProfileQueryPort";
import type {
  AssetOwnerProfileInputPort,
  AssetOwnerProfileView,
  AssetOwnerUiSurfaceInputPort,
  VerifiedAssetOwnerUiActor,
  VerifiedProfileActor,
} from "../../src/contexts/access/public";
import { createAssetOwnerProfileFixtureSubject } from "./asset-owner-profile-fixture";

const householdId = "household-owner-ui";

const activeMemberActor: VerifiedProfileActor = {
  principalUid: "uid-member",
  householdId,
  actingMemberId: "member-min",
  capabilities: ["household.asset-owner-profile.write"],
};

class PublicAssetOwnerProfileQueryAdapter
  implements ActiveAssetOwnerProfileQueryPort
{
  constructor(private readonly profiles: AssetOwnerProfileInputPort) {}

  async listActiveProfiles(
    principalRef: string,
  ): Promise<
    readonly {
      profileId: string;
      displayName: string;
      profileType: "member" | "dependent";
    }[]
  > {
    const actor: VerifiedProfileActor = {
      ...activeMemberActor,
      principalUid: principalRef,
    };
    const result = await this.profiles.listAssetOwnerProfiles(actor, {
      includeArchived: false,
    });
    return result.kind === "success"
      ? result.profiles.map(({ profileId, displayName, profileType }) => ({
          profileId,
          displayName,
          profileType,
        }))
      : [];
  }
}

export function createAssetOwnerUiSurfaceFixtureSubject(): AssetOwnerUiSurfaceInputPort {
  const activeDependent: AssetOwnerProfileView = {
    profileId: "profile-dependent-jia",
    householdId,
    displayName: "지아",
    profileType: "dependent",
    lifecycleState: "active",
    aggregateVersion: 2,
  };
  const archivedDependent: AssetOwnerProfileView = {
    profileId: "profile-dependent-archived",
    householdId,
    displayName: "과거 명의자",
    profileType: "dependent",
    lifecycleState: "archived",
    aggregateVersion: 3,
  };
  const profileSubject = createAssetOwnerProfileFixtureSubject({
    householdId,
    members: [
      {
        principalUid: activeMemberActor.principalUid,
        memberId: "member-min",
        displayName: "민규",
        profileId: "profile-member-min",
        aggregateVersion: 1,
      },
    ],
    dependentProfiles: [activeDependent, archivedDependent],
  });

  return createAssetOwnerUiSurfaceApplication({
    profiles: new PublicAssetOwnerProfileQueryAdapter(profileSubject),
  });
}

export type AssetOwnerUiFixtureActor = VerifiedAssetOwnerUiActor;

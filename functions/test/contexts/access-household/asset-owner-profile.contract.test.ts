import { describe, expect, it } from "vitest";
import type {
  AssetOwnerProfileInputPort,
  AssetOwnerProfileView,
  VerifiedProfileActor,
} from "../../../src/contexts/access/public";
import {
  createAssetOwnerProfileFixtureSubject,
  type AssetOwnerProfileEvent,
  type AssetOwnerProfileFixture,
  type AssetOwnerProfileSnapshot,
} from "../../support/asset-owner-profile-fixture";

/**
 * Access가 소유하는 안정 명의자 identity의 공개 계약입니다.
 * snapshot은 최종 Canonical ID와 공개 참조만 보여 주며 저장 경로를 노출하지 않습니다.
 */
export interface AssetOwnerProfileSubject extends AssetOwnerProfileInputPort {
  snapshot(): Promise<AssetOwnerProfileSnapshot>;
  publishedEvents(): Promise<readonly AssetOwnerProfileEvent[]>;
}

export function createSubject(
  fixture: AssetOwnerProfileFixture,
): AssetOwnerProfileSubject {
  return createAssetOwnerProfileFixtureSubject(fixture);
}

const householdId = "household-owner-profile";
const memberId = "member-min-gyu";
const memberProfileId = "profile-member-min-gyu";

const memberActor: VerifiedProfileActor = {
  principalUid: "google-min-gyu",
  householdId,
  actingMemberId: memberId,
  capabilities: ["household.asset-owner-profile.write"],
};

const globalAdmin: VerifiedProfileActor = {
  principalUid: "verified-global-admin",
  householdId,
  capabilities: ["admin.asset-owner-profile.archive"],
};

const baseFixture = (
  overrides: Partial<AssetOwnerProfileFixture> = {},
): AssetOwnerProfileFixture => ({
  householdId,
  members: [
    {
      principalUid: memberActor.principalUid,
      memberId,
      displayName: "민규",
      profileId: memberProfileId,
      aggregateVersion: 1,
    },
  ],
  dependentProfiles: [],
  ownerReferences: [],
  ...overrides,
});

async function createDependent(subject: AssetOwnerProfileSubject) {
  const result = await subject.createAssetOwnerProfile(memberActor, {
    displayName: "지아",
    idempotencyKey: "create-dependent-jia",
  });
  expect(result.kind).toBe("success");
  if (result.kind !== "success") {
    throw new Error("테스트 준비용 dependent 프로필 생성에 실패했습니다.");
  }
  return result.profile;
}

describe("AssetOwnerProfile household/dependent identity 공개 계약", () => {
  it("[T-HH-006][HH-011/DEC-037] Member마다 같은 memberId에 연결된 member 프로필 하나만 제공한다", async () => {
    const subject = createSubject(baseFixture());

    const result = await subject.listAssetOwnerProfiles(memberActor, {});

    expect(result).toEqual({
      kind: "success",
      profiles: [
        {
          profileId: memberProfileId,
          householdId,
          displayName: "민규",
          profileType: "member",
          linkedMemberId: memberId,
          lifecycleState: "active",
          aggregateVersion: expect.any(Number),
        },
      ],
    });
    const state = await subject.snapshot();
    expect(
      state.profiles.filter(
        (profile) =>
          profile.profileType === "member" &&
          profile.linkedMemberId === memberId,
      ),
    ).toHaveLength(1);
  });

  it("[T-HH-006][HH-011/DEC-037] 자산 명의자는 profile ID나 유형이 아니라 가구에 들어온 순서로 제공한다", async () => {
    const subject = createSubject(
      baseFixture({
        members: [
          {
            principalUid: memberActor.principalUid,
            memberId,
            displayName: "민규",
            profileId: "profile-z-min-gyu",
            aggregateVersion: 1,
            enteredAt: "2026-07-21T14:02:28.926Z",
          },
          {
            principalUid: "google-jin-seon",
            memberId: "member-jin-seon",
            displayName: "진선",
            profileId: "profile-y-jin-seon",
            aggregateVersion: 1,
            enteredAt: "2026-07-21T14:09:58.222Z",
          },
        ],
        dependentProfiles: [
          {
            profileId: "profile-a-jia",
            householdId,
            displayName: "지아",
            profileType: "dependent",
            lifecycleState: "active",
            aggregateVersion: 1,
            enteredAt: "2026-07-21T14:20:15.621Z",
          },
        ],
      }),
    );

    const result = await subject.listAssetOwnerProfiles(memberActor, {});

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.profiles.map(({ displayName }) => displayName)).toEqual([
        "민규",
        "진선",
        "지아",
      ]);
      expect(result.profiles[0]).not.toHaveProperty("createdAt");
    }
  });

  it("[T-HH-006][HH-011/DEC-037] dependent 생성은 로그인·Membership·권한 identity를 만들지 않는다", async () => {
    const subject = createSubject(baseFixture());
    const before = await subject.snapshot();

    const profile = await createDependent(subject);

    expect(profile).toEqual({
      profileId: expect.any(String),
      householdId,
      displayName: "지아",
      profileType: "dependent",
      lifecycleState: "active",
      aggregateVersion: expect.any(Number),
    });
    expect(profile).not.toHaveProperty("linkedMemberId");
    expect(profile).not.toHaveProperty("principalUid");
    expect(profile).not.toHaveProperty("capabilities");

    const after = await subject.snapshot();
    expect(after.members).toEqual(before.members);
    expect(after.memberships).toEqual(before.memberships);
    expect(after.profiles).toHaveLength(before.profiles.length + 1);
    const event = (await subject.publishedEvents()).find(
      (candidate) => candidate.payload.profileId === profile.profileId,
    );
    expect(event).toEqual({
      eventType: "AssetOwnerProfileChanged.v1",
      householdId,
      payload: {
        profileId: profile.profileId,
        profileType: "dependent",
        lifecycleState: "active",
        newDisplayName: "지아",
      },
    });
    expect(event?.payload).not.toHaveProperty("principalUid");
  });

  it("[T-HH-006][HH-011] dependent 이름 변경은 profileId와 기존 자산의 owner reference를 유지한다", async () => {
    const existingProfile: AssetOwnerProfileView = {
      profileId: "profile-dependent-jia",
      householdId,
      displayName: "지아",
      profileType: "dependent",
      lifecycleState: "active",
      aggregateVersion: 4,
    };
    const subject = createSubject(
      baseFixture({
        dependentProfiles: [existingProfile],
        ownerReferences: [
          { referenceId: "asset-child-account", profileId: existingProfile.profileId },
          { referenceId: "snapshot-2026-07-18", profileId: existingProfile.profileId },
        ],
      }),
    );
    const referenceBefore = await subject.snapshot();

    const result = await subject.renameAssetOwnerProfile(memberActor, {
      profileId: existingProfile.profileId,
      displayName: "지아(변경)",
      expectedVersion: existingProfile.aggregateVersion,
      idempotencyKey: "rename-dependent-jia",
    });

    expect(result).toEqual({
      kind: "success",
      profile: {
        ...existingProfile,
        displayName: "지아(변경)",
        aggregateVersion: existingProfile.aggregateVersion + 1,
      },
    });
    const after = await subject.snapshot();
    expect(after.ownerReferences).toEqual(referenceBefore.ownerReferences);
    expect(
      after.profiles.find(
        (profile) => profile.profileId === existingProfile.profileId,
      ),
    ).toEqual(
      expect.objectContaining({
        profileId: existingProfile.profileId,
        displayName: "지아(변경)",
      }),
    );
  });

  it("[T-HH-006][HH-011/DEC-037] 일반 가구원의 archive 호출은 거부하고 프로필을 변경하지 않는다", async () => {
    const subject = createSubject(baseFixture());
    const profile = await createDependent(subject);
    const before = await subject.snapshot();

    const result = await subject.archiveAssetOwnerProfile(memberActor, {
      profileId: profile.profileId,
      expectedVersion: profile.aggregateVersion,
      idempotencyKey: "member-cannot-archive",
    });

    expect(result.kind).toBe("forbidden");
    expect(await subject.snapshot()).toEqual(before);
  });

  it("[T-HH-006][HH-011/DEC-037] 전체 관리자만 dependent를 논리 보관하고 과거 profileId 해석은 유지한다", async () => {
    const subject = createSubject(baseFixture());
    const profile = await createDependent(subject);

    const result = await subject.archiveAssetOwnerProfile(globalAdmin, {
      profileId: profile.profileId,
      expectedVersion: profile.aggregateVersion,
      idempotencyKey: "admin-archive-dependent",
    });

    expect(result).toEqual({
      kind: "success",
      profile: {
        ...profile,
        lifecycleState: "archived",
        aggregateVersion: profile.aggregateVersion + 1,
      },
    });

    const activeList = await subject.listAssetOwnerProfiles(memberActor, {});
    if (activeList.kind === "success") {
      expect(
        activeList.profiles.some(
          (candidate) => candidate.profileId === profile.profileId,
        ),
      ).toBe(false);
    }
    const historyList = await subject.listAssetOwnerProfiles(memberActor, {
      includeArchived: true,
    });
    expect(historyList).toEqual({
      kind: "success",
      profiles: expect.arrayContaining([
        expect.objectContaining({
          profileId: profile.profileId,
          displayName: profile.displayName,
          lifecycleState: "archived",
        }),
      ]),
    });
    await expect(
      subject.resolveOwnerProfileForHistory(memberActor, profile.profileId),
    ).resolves.toEqual(
      expect.objectContaining({
        profileId: profile.profileId,
        displayName: profile.displayName,
        lifecycleState: "archived",
      }),
    );
  });

  it("[T-HH-006][HH-011/DEC-037] 전체 관리자도 Member 연결 프로필은 보관할 수 없다", async () => {
    const subject = createSubject(baseFixture());
    const memberProfile = (await subject.snapshot()).profiles.find(
      (profile) => profile.profileId === memberProfileId,
    );
    expect(memberProfile).toBeDefined();
    if (!memberProfile) {
      throw new Error("Member 연결 프로필이 필요합니다.");
    }

    const result = await subject.archiveAssetOwnerProfile(globalAdmin, {
      profileId: memberProfile.profileId,
      expectedVersion: memberProfile.aggregateVersion,
      idempotencyKey: "admin-cannot-archive-member-profile",
    });

    expect(result).toEqual({
      kind: "conflict",
      code: "MEMBER_PROFILE_IMMUTABLE",
    });
    expect(
      (await subject.snapshot()).profiles.find(
        (profile) => profile.profileId === memberProfileId,
      ),
    ).toEqual(memberProfile);
  });

  it("[T-HH-006][HH-009/HH-011] 자기 이름 변경은 같은 member profile만 갱신하고 안정 ID를 유지한다", async () => {
    const subject = createSubject(
      baseFixture({
        ownerReferences: [
          { referenceId: "asset-existing", profileId: memberProfileId },
          { referenceId: "snapshot-existing", profileId: memberProfileId },
        ],
      }),
    );
    const before = await subject.snapshot();

    const result = await subject.renameSelf(memberActor, {
      displayName: "민규(변경)",
      expectedMemberVersion: 1,
      idempotencyKey: "rename-self-and-profile",
    });

    expect(result).toEqual({
      kind: "success",
      memberId,
      displayName: "민규(변경)",
    });
    const after = await subject.snapshot();
    expect(after.ownerReferences).toEqual(before.ownerReferences);
    expect(
      after.profiles.filter(
        (profile) => profile.linkedMemberId === memberId,
      ),
    ).toEqual([
      expect.objectContaining({
        profileId: memberProfileId,
        displayName: "민규(변경)",
        lifecycleState: "active",
      }),
    ]);
    expect(after.members).toEqual([
      {
        principalUid: memberActor.principalUid,
        memberId,
        displayName: "민규(변경)",
        aggregateVersion: 2,
      },
    ]);
  });
});

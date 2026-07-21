import { describe, expect, it } from "vitest";
import {
  createAssetOwnerProfileLifecycleDriver,
  type AssetOwnerProfileLifecycleDriver,
  type AssetOwnerProfileLifecycleFixture,
  type OwnedAssetView,
  type OwnerActor,
  type OwnerHistoryPoint,
  type OwnerProfileView,
} from "../../support/asset-owner-profile-lifecycle-driver";

/** 자산 명의자 프로필과 선택 surface의 공개 계약입니다. */
export interface AssetOwnerProfileLifecycleSubject
  extends AssetOwnerProfileLifecycleDriver {}

export function createSubject(
  fixture: AssetOwnerProfileLifecycleFixture,
): AssetOwnerProfileLifecycleSubject {
  return createAssetOwnerProfileLifecycleDriver(fixture);
}

const member: OwnerActor = {
  principalUid: "google-min",
  actingMemberId: "member-min",
  householdId: "house-1",
  capabilities: [
    "portfolio.asset.read",
    "portfolio.asset.write",
    "household.asset-owner-profile.write",
  ],
};

const administrator: OwnerActor = {
  principalUid: "google-min",
  actingMemberId: "member-min",
  householdId: "house-1",
  capabilities: [
    "portfolio.asset.read",
    "portfolio.asset.write",
    "household.asset-owner-profile.write",
    "admin.asset-owner-profile.archive",
  ],
};

const minProfile: OwnerProfileView = {
  profileId: "profile-min",
  householdId: "house-1",
  displayName: "민규",
  kind: "login-member",
  lifecycle: "active",
  version: 2,
};

const childProfile: OwnerProfileView = {
  profileId: "profile-child",
  householdId: "house-1",
  displayName: "지아",
  kind: "dependent",
  lifecycle: "active",
  version: 1,
};

function fixture(
  profiles: readonly OwnerProfileView[],
  overrides: Partial<AssetOwnerProfileLifecycleFixture> = {},
): AssetOwnerProfileLifecycleFixture {
  return {
    profiles,
    memberBindings: [
      {
        profileId: minProfile.profileId,
        principalUid: member.principalUid,
        memberId: member.actingMemberId!,
      },
    ],
    ...overrides,
  };
}

describe("Portfolio 자산 명의자 lifecycle 계약", () => {
  it("[T-AST-005][AST-009/DEC-037] 선택 surface는 전체와 active 명의자를 안정 ID로 제공하고 dependent 추가 capability를 노출한다", async () => {
    const result = await createSubject(
      fixture([minProfile, childProfile]),
    ).getOwnerSelector(member);

    expect(result).toMatchObject({
      includesHouseholdTotal: true,
      capabilities: {
        canCreateDependentProfile: true,
        canArchiveProfile: false,
      },
    });
    expect(result.activeProfiles).toHaveLength(2);
    expect(result.activeProfiles).toEqual(
      expect.arrayContaining([minProfile, childProfile]),
    );
    expect(result.activeProfiles.map(({ profileId }) => profileId).sort()).toEqual(
      ["profile-min", "profile-child"].sort(),
    );
  });

  it("[T-AST-005][AST-009] 활성 가구원은 로그인 계정이 없는 dependent 명의자를 만들고 그 ID로 자산을 등록한다", async () => {
    const subject = createSubject(fixture([minProfile]));

    const created = await subject.createDependentProfile({
      actor: member,
      commandId: "create-owner-child",
      idempotencyKey: "create-owner-child",
      displayName: "  지아  ",
    });
    expect(created).toEqual({
      kind: "success",
      profile: expect.objectContaining({
        householdId: "house-1",
        displayName: "지아",
        kind: "dependent",
        lifecycle: "active",
        version: 1,
      }),
    });
    if (created.kind !== "success") return;
    expect((await subject.getOwnerSelector(member)).activeProfiles).toContainEqual(
      created.profile,
    );

    const asset = await subject.createAsset({
      actor: member,
      commandId: "create-child-asset",
      name: "아이 명의 주식",
      ownerRef: { kind: "profile", profileId: created.profile.profileId },
    });
    expect(asset).toEqual({
      kind: "success",
      asset: expect.objectContaining({
        householdId: "house-1",
        ownerRef: {
          kind: "profile",
          profileId: created.profile.profileId,
        },
      }),
    });
    expect(await subject.listCurrentAssets(member)).toEqual([
      asset.kind === "success" ? asset.asset : undefined,
    ]);
  });

  it("[T-AST-005][T-AST-007][AST-001/AST-009] household 공동 명의는 허용하지만 타 가구·archived profile 신규 선택은 거부한다", async () => {
    const archived = { ...childProfile, lifecycle: "archived" as const };
    const foreign = {
      ...childProfile,
      profileId: "profile-foreign",
      householdId: "house-2",
    };
    const subject = createSubject(
      fixture([minProfile, archived, foreign]),
    );

    expect(
      await subject.createAsset({
        actor: member,
        commandId: "create-household-asset",
        name: "공동 자산",
        ownerRef: { kind: "household" },
      }),
    ).toEqual({
      kind: "success",
      asset: expect.objectContaining({ ownerRef: { kind: "household" } }),
    });
    expect(
      await subject.createAsset({
        actor: member,
        commandId: "create-archived-owner-asset",
        name: "보관 명의 자산",
        ownerRef: { kind: "profile", profileId: archived.profileId },
      }),
    ).toEqual({ kind: "validation-error", code: "INVALID_OWNER_REF" });
    expect(
      await subject.createAsset({
        actor: member,
        commandId: "create-foreign-owner-asset",
        name: "타 가구 명의 자산",
        ownerRef: { kind: "profile", profileId: foreign.profileId },
      }),
    ).toEqual({ kind: "validation-error", code: "INVALID_OWNER_REF" });
  });

  it("[T-AST-005][AST-009] 일반 사용자는 archive할 수 없고 관리 작업만 명의자를 신규 선택에서 제외한다", async () => {
    const subject = createSubject(fixture([minProfile, childProfile]));

    expect(
      await subject.archiveProfile({
        actor: member,
        commandId: "archive-by-member",
        idempotencyKey: "archive-by-member",
        profileId: childProfile.profileId,
        expectedVersion: 1,
        auditReason: "삭제 요청",
      }),
    ).toEqual({
      kind: "forbidden",
      code: "PROFILE_ARCHIVE_FORBIDDEN",
    });
    expect((await subject.getOwnerSelector(member)).activeProfiles).toEqual(
      expect.arrayContaining([minProfile, childProfile]),
    );

    expect(
      await subject.archiveProfile({
        actor: administrator,
        commandId: "archive-by-admin",
        idempotencyKey: "archive-by-admin",
        profileId: childProfile.profileId,
        expectedVersion: 1,
        auditReason: "명의자 정리",
      }),
    ).toEqual({
      kind: "success",
      profile: {
        ...childProfile,
        lifecycle: "archived",
        version: 2,
      },
    });
    expect(await subject.getOwnerSelector(administrator)).toMatchObject({
      activeProfiles: [minProfile],
      capabilities: { canArchiveProfile: true },
    });
  });

  it("[T-AST-005][T-AST-006][AST-009/DEC-058] archive 뒤에도 기존 자산과 과거 snapshot 명의자 filter는 그대로 조회된다", async () => {
    const existingAsset: OwnedAssetView = {
      assetId: "asset-child",
      householdId: "house-1",
      name: "지아 자산",
      ownerRef: { kind: "profile", profileId: childProfile.profileId },
    };
    const history: readonly OwnerHistoryPoint[] = [
      {
        snapshotDate: "2026-06-30",
        ownerRefKey: `profile:${childProfile.profileId}`,
        amountInWon: 30_000_000,
      },
    ];
    const subject = createSubject(
      fixture(
        [minProfile, childProfile],
        { assets: [existingAsset], history },
      ),
    );

    expect(
      await subject.archiveProfile({
        actor: administrator,
        commandId: "archive-owner-with-history",
        idempotencyKey: "archive-owner-with-history",
        profileId: childProfile.profileId,
        expectedVersion: childProfile.version,
        auditReason: "명의자 정리",
      }),
    ).toMatchObject({
      kind: "success",
      profile: {
        profileId: childProfile.profileId,
        lifecycle: "archived",
        version: childProfile.version + 1,
      },
    });

    expect((await subject.getOwnerSelector(member)).activeProfiles).toEqual([
      minProfile,
    ]);
    expect(await subject.listCurrentAssets(member)).toEqual([existingAsset]);
    expect(await subject.listHistoricalOwnerDimensions(member)).toContainEqual({
      ownerRefKey: "profile:profile-child",
      displayName: "지아",
    });
    expect(
      await subject.queryOwnerHistory(member, "profile:profile-child"),
    ).toEqual(history);
  });
});

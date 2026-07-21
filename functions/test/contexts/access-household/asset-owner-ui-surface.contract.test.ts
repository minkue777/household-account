import { describe, expect, it } from "vitest";
import type {
  AssetOwnerUiSurfaceInputPort,
} from "../../../src/contexts/access/public";
import { createAssetOwnerUiSurfaceFixtureSubject } from "../../support/asset-owner-ui-surface-fixture";

/** 일반 자산 UI와 별도 관리자 UI가 노출하는 공개 action 목록 계약입니다. */
export interface AssetOwnerUiSurfaceContractSubject
  extends AssetOwnerUiSurfaceInputPort {}

export function createSubject(): AssetOwnerUiSurfaceContractSubject {
  return createAssetOwnerUiSurfaceFixtureSubject();
}

describe("자산 명의자 일반·관리자 UI action surface 계약", () => {
  it("[T-HH-006][HH-011/DEC-037] 일반 자산 UI에는 dependent 생성·이름 변경·선택만 있고 삭제·보관 action이 없다", async () => {
    const subject = createSubject();

    const view = await subject.viewFor(
      { principalRef: "uid-member", capabilities: ["household.asset-owner-profile.write"] },
      "ordinary-asset-owner-selector",
    );

    expect(view.surface).toBe("ordinary-asset-owner-selector");
    expect(view.actions).toEqual(
      expect.arrayContaining([
        "create-dependent",
        "rename-dependent",
        "select-owner",
      ]),
    );
    expect(view.actions).not.toContain("archive-dependent");
    expect(JSON.stringify(view.actions)).not.toContain("delete-dependent");
  });

  it("[T-HH-006][HH-011/DEC-037] 명의자 필터는 전체·활성 명의자들·+ 순서이며 archived 명의자를 현재 목록에 노출하지 않는다", async () => {
    const subject = createSubject();

    const view = await subject.viewFor(
      {
        principalRef: "uid-member",
        capabilities: ["household.asset-owner-profile.write"],
      },
      "ordinary-asset-owner-selector",
    );

    expect(view.selectorItems[0]).toEqual({
      kind: "all",
      key: "all",
      label: "전체",
    });
    expect(view.selectorItems.at(-1)).toEqual({
      kind: "add-dependent",
      key: "add-dependent",
      label: "+",
    });
    expect(view.selectorItems.slice(1, -1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "owner-profile",
          profileId: "profile-member-min",
          label: "민규",
          profileType: "member",
        }),
        expect.objectContaining({
          kind: "owner-profile",
          profileId: "profile-dependent-jia",
          label: "지아",
          profileType: "dependent",
        }),
      ]),
    );
    expect(
      view.selectorItems.some(
        (item) =>
          item.kind === "owner-profile" &&
          item.profileId === "profile-dependent-archived",
      ),
    ).toBe(false);
  });

  it("[T-HH-006][HH-011/DEC-037] archive action은 검증된 관리자 capability가 있는 별도 관리 surface에서만 보인다", async () => {
    const subject = createSubject();
    const ordinaryAdminSurface = await subject.viewFor(
      { principalRef: "uid-member", capabilities: [] },
      "administrator-owner-management",
    );
    const verifiedAdminSurface = await subject.viewFor(
      {
        principalRef: "verified-admin",
        capabilities: ["admin.asset-owner-profile.archive"],
      },
      "administrator-owner-management",
    );
    const verifiedAdminOrdinarySurface = await subject.viewFor(
      {
        principalRef: "verified-admin",
        capabilities: ["admin.asset-owner-profile.archive"],
      },
      "ordinary-asset-owner-selector",
    );

    expect(ordinaryAdminSurface.actions).not.toContain("archive-dependent");
    expect(verifiedAdminSurface.actions).toContain("archive-dependent");
    expect(verifiedAdminOrdinarySurface.actions).not.toContain(
      "archive-dependent",
    );
  });
});

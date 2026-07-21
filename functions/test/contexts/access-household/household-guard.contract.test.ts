import { describe, expect, it } from "vitest";
import type { HouseholdGuardInputPort } from "../../../src/contexts/access/public";
import { createHouseholdGuardFixtureSubject } from "../../support/household-guard-fixture";

/**
 * 보호 화면이 서버에서 검증된 Principal·Membership 또는 별도 admin capability만
 * 받아들이는 Client/Application 경계입니다.
 */
export interface HouseholdGuardContractSubject extends HouseholdGuardInputPort {
  displayedHouseholdIds(): readonly string[];
}

export function createSubject(): HouseholdGuardContractSubject {
  return createHouseholdGuardFixtureSubject();
}

const verifiedPrincipal = {
  principalRef: "uid-member",
  verified: true,
  capabilities: [] as readonly string[],
};

describe("보호 화면 Household Guard 공개 계약", () => {
  it("[T-HH-001][HH-008] 검증된 Principal의 같은 가구 active Membership만 보호 데이터를 표시한다", async () => {
    const subject = createSubject();

    await expect(
      subject.enter({
        principal: verifiedPrincipal,
        requestedHouseholdId: "house-1",
        membership: {
          householdId: "house-1",
          memberId: "member-1",
          status: "active",
        },
        legacyCandidate: "absent",
      }),
    ).resolves.toEqual({
      kind: "protected-content",
      actor: { householdId: "house-1", memberId: "member-1" },
    });
    expect(subject.displayedHouseholdIds()).toEqual(["house-1"]);
  });

  it.each([
    {
      name: "인증 없음",
      principal: undefined,
      membership: undefined,
      code: "AUTH_REQUIRED" as const,
    },
    {
      name: "검증되지 않은 Principal",
      principal: { ...verifiedPrincipal, verified: false },
      membership: {
        householdId: "house-1",
        memberId: "member-1",
        status: "active" as const,
      },
      code: "UNVERIFIED_PRINCIPAL" as const,
    },
    {
      name: "removed Membership",
      principal: verifiedPrincipal,
      membership: {
        householdId: "house-1",
        memberId: "member-1",
        status: "removed" as const,
      },
      code: "ACTIVE_MEMBERSHIP_REQUIRED" as const,
    },
    {
      name: "타 가구 Membership",
      principal: verifiedPrincipal,
      membership: {
        householdId: "house-2",
        memberId: "member-2",
        status: "active" as const,
      },
      code: "HOUSEHOLD_SCOPE_MISMATCH" as const,
    },
  ])(
    "[T-HH-001/T-HH-JOIN-001][HH-008] $name은 legacy key를 함께 제시해도 보호 데이터를 표시하지 않는다",
    async ({ principal, membership, code }) => {
      const subject = createSubject();

      await expect(
        subject.enter({
          principal,
          requestedHouseholdId: "house-1",
          membership,
          legacyCandidate: "absent",
          presentedLegacyKey: "known-household-key",
        }),
      ).resolves.toEqual({ kind: "denied", code });
      expect(subject.displayedHouseholdIds()).toEqual([]);
    },
  );

  it("[T-HH-001/T-HH-JOIN-001][HH-008] Membership이 없으면 완전 legacy 후보는 전환 확인, 후보가 없으면 first visit으로 분기한다", async () => {
    const legacy = createSubject();
    await expect(
      legacy.enter({
        principal: verifiedPrincipal,
        requestedHouseholdId: "house-1",
        legacyCandidate: "complete",
      }),
    ).resolves.toEqual({ kind: "legacy-confirmation-required" });
    expect(legacy.displayedHouseholdIds()).toEqual([]);

    const firstVisit = createSubject();
    await expect(
      firstVisit.enter({
        principal: verifiedPrincipal,
        requestedHouseholdId: "house-1",
        legacyCandidate: "absent",
      }),
    ).resolves.toEqual({
      kind: "first-visit-required",
      choices: ["create", "join"],
    });
    expect(firstVisit.displayedHouseholdIds()).toEqual([]);
  });

  it("[T-HH-JOIN-001][HH-008/ADM-002] admin은 raw key가 아니라 검증된 read capability로만 별도 화면에 접근한다", async () => {
    const allowed = createSubject();
    await expect(
      allowed.enter({
        principal: {
          principalRef: "verified-admin",
          verified: true,
          capabilities: ["admin.households.read"],
        },
        requestedHouseholdId: "house-1",
        legacyCandidate: "absent",
      }),
    ).resolves.toEqual({ kind: "admin-content", householdId: "house-1" });

    const keyOnly = createSubject();
    await expect(
      keyOnly.enter({
        principal: verifiedPrincipal,
        requestedHouseholdId: "house-1",
        legacyCandidate: "absent",
        presentedLegacyKey: "admin-looking-key",
      }),
    ).resolves.toEqual({
      kind: "first-visit-required",
      choices: ["create", "join"],
    });
    expect(keyOnly.displayedHouseholdIds()).toEqual([]);
  });
});

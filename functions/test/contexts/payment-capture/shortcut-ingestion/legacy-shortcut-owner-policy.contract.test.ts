import { describe, expect, it } from "vitest";

import { createLegacyShortcutOwnerPolicyFixture } from "../../../support/legacy-shortcut-owner-policy-fixture";

export interface LegacyOwnerPolicyInput {
  householdId: string;
  requestedOwnerMemberId?: string;
  currentFcmOwner?: { householdId: string; memberId: string };
  registeredCards: readonly {
    householdId: string;
    ownerMemberId: string;
    company: string;
    lastFour?: string;
  }[];
  parsedCard: { company: string; lastFour?: string };
  companyOwners: readonly {
    householdId: string;
    company: string;
    memberId: string;
  }[];
}

export type LegacyOwnerPolicyResult =
  | {
      kind: "Resolved";
      memberId: string;
      evidence:
        | "CURRENT_FCM_OWNER"
        | "FIRST_MATCHING_REGISTERED_CARD"
        | "UNIQUE_COMPANY_OWNER"
        | "REQUEST_OWNER_FALLBACK";
    }
  | { kind: "Unresolved" };

export interface LegacyShortcutOwnerPolicyContractSubject {
  resolve(input: LegacyOwnerPolicyInput): LegacyOwnerPolicyResult;
}

export function createSubject(): LegacyShortcutOwnerPolicyContractSubject {
  return createLegacyShortcutOwnerPolicyFixture();
}

function baseInput(
  overrides: Partial<LegacyOwnerPolicyInput> = {},
): LegacyOwnerPolicyInput {
  return {
    householdId: "household-1",
    requestedOwnerMemberId: "member-request",
    currentFcmOwner: { householdId: "household-1", memberId: "member-fcm" },
    registeredCards: [
      {
        householdId: "household-1",
        ownerMemberId: "member-card",
        company: "국민",
        lastFour: "1234",
      },
    ],
    parsedCard: { company: "국민", lastFour: "1234" },
    companyOwners: [
      {
        householdId: "household-1",
        company: "국민",
        memberId: "member-company",
      },
    ],
    ...overrides,
  };
}

describe("legacy Shortcut owner 추론 공개 계약", () => {
  it("[T-IOS-OWNER-LEGACY-001][IOS-005] 같은 가구의 현재 FCM owner를 가장 먼저 선택한다", () => {
    expect(createSubject().resolve(baseInput())).toEqual({
      kind: "Resolved",
      memberId: "member-fcm",
      evidence: "CURRENT_FCM_OWNER",
    });
  });

  it("[T-IOS-OWNER-LEGACY-001][IOS-005] FCM owner가 없으면 저장 순서상 첫 일치 등록 카드 owner를 선택한다", () => {
    const result = createSubject().resolve(
      baseInput({
        currentFcmOwner: undefined,
        registeredCards: [
          {
            householdId: "household-1",
            ownerMemberId: "member-first",
            company: "국민",
            lastFour: "1234",
          },
          {
            householdId: "household-1",
            ownerMemberId: "member-second",
            company: "국민",
            lastFour: "1234",
          },
        ],
      }),
    );

    expect(result).toEqual({
      kind: "Resolved",
      memberId: "member-first",
      evidence: "FIRST_MATCHING_REGISTERED_CARD",
    });
  });

  it("[T-IOS-OWNER-LEGACY-001][IOS-005] 카드가 없으면 같은 가구·카드사의 유일 owner만 선택한다", () => {
    expect(
      createSubject().resolve(
        baseInput({ currentFcmOwner: undefined, registeredCards: [] }),
      ),
    ).toEqual({
      kind: "Resolved",
      memberId: "member-company",
      evidence: "UNIQUE_COMPANY_OWNER",
    });
  });

  it("[T-IOS-OWNER-LEGACY-001][IOS-005] 앞선 증거가 없으면 비어 있지 않은 request owner를 legacy fallback으로 사용한다", () => {
    expect(
      createSubject().resolve(
        baseInput({
          currentFcmOwner: undefined,
          registeredCards: [],
          companyOwners: [],
        }),
      ),
    ).toEqual({
      kind: "Resolved",
      memberId: "member-request",
      evidence: "REQUEST_OWNER_FALLBACK",
    });
  });

  it.each([
    {
      name: "다른 가구 FCM owner",
      overrides: {
        currentFcmOwner: {
          householdId: "household-other",
          memberId: "member-other",
        },
      },
    },
    {
      name: "동일 카드사의 복수 owner",
      overrides: {
        currentFcmOwner: undefined,
        registeredCards: [],
        requestedOwnerMemberId: undefined,
        companyOwners: [
          {
            householdId: "household-1",
            company: "국민",
            memberId: "member-a",
          },
          {
            householdId: "household-1",
            company: "국민",
            memberId: "member-b",
          },
        ],
      },
    },
  ])(
    "[T-IOS-OWNER-LEGACY-001][IOS-005] $name만으로는 owner를 잘못 귀속하지 않는다",
    ({ overrides }) => {
      expect(
        createSubject().resolve(
          baseInput({
            registeredCards: [],
            companyOwners: [],
            requestedOwnerMemberId: undefined,
            ...overrides,
          }),
        ),
      ).toEqual({ kind: "Unresolved" });
    },
  );

  it("빈 FCM member는 권한 증거로 쓰지 않고 다음 카드 증거로 진행한다", () => {
    expect(
      createSubject().resolve(
        baseInput({
          currentFcmOwner: { householdId: "household-1", memberId: "  " },
        }),
      ),
    ).toEqual({
      kind: "Resolved",
      memberId: "member-card",
      evidence: "FIRST_MATCHING_REGISTERED_CARD",
    });
  });

  it("번호 없는 같은 카드사 등록 카드는 legacy 카드 증거와 일치한다", () => {
    expect(
      createSubject().resolve(
        baseInput({
          currentFcmOwner: undefined,
          registeredCards: [
            {
              householdId: "household-1",
              ownerMemberId: "member-wildcard",
              company: " 국민 ",
            },
          ],
        }),
      ),
    ).toEqual({
      kind: "Resolved",
      memberId: "member-wildcard",
      evidence: "FIRST_MATCHING_REGISTERED_CARD",
    });
  });

  it("같은 member가 중복된 카드사 owner 자료는 서로 다른 복수 owner로 세지 않는다", () => {
    expect(
      createSubject().resolve(
        baseInput({
          currentFcmOwner: undefined,
          registeredCards: [],
          requestedOwnerMemberId: undefined,
          companyOwners: [
            { householdId: "household-1", company: "국민", memberId: "member-a" },
            { householdId: "household-1", company: " 국민 ", memberId: "member-a" },
          ],
        }),
      ),
    ).toEqual({
      kind: "Resolved",
      memberId: "member-a",
      evidence: "UNIQUE_COMPANY_OWNER",
    });
  });

  it("공백 request owner는 fallback으로 사용하지 않는다", () => {
    expect(
      createSubject().resolve(
        baseInput({
          currentFcmOwner: undefined,
          registeredCards: [],
          companyOwners: [],
          requestedOwnerMemberId: "   ",
        }),
      ),
    ).toEqual({ kind: "Unresolved" });
  });

  it("다른 가구의 등록 카드는 카드가 일치해도 owner 증거가 아니다", () => {
    expect(
      createSubject().resolve(
        baseInput({
          currentFcmOwner: undefined,
          registeredCards: [
            {
              householdId: "household-other",
              ownerMemberId: "member-other",
              company: "국민",
              lastFour: "1234",
            },
          ],
          companyOwners: [],
          requestedOwnerMemberId: undefined,
        }),
      ),
    ).toEqual({ kind: "Unresolved" });
  });
});

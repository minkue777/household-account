import { describe, expect, it } from "vitest";

import { createOwnCardResolutionPolicy } from "../../../../src/contexts/payment-capture/configuration/public";

export interface RegisteredCardFixture {
  cardId: string;
  ownerMemberId: string;
  cardCompany: string;
  lastFour: string;
  orderIndex?: number;
  lifecycleState: "active" | "retired";
}

export interface ParsedCardEvidence {
  companyLabel: string;
  maskedToken?: string;
}

export type OwnCardResolutionResult =
  | {
      kind: "eligible";
      canonicalEvidence?: {
        cardId: string;
        companyLabel: string;
        lastFour: string;
      };
    }
  | {
      kind: "unmatched";
      reason: "CARD_NOT_REGISTERED_FOR_ACTOR";
    };

export interface OwnCardResolutionContractSubject {
  resolve(input: {
    actingMemberId: string;
    evidence: ParsedCardEvidence;
    cards: readonly RegisteredCardFixture[];
  }): OwnCardResolutionResult;

  listActiveCards(input: {
    actingMemberId: string;
    cards: readonly RegisteredCardFixture[];
  }): readonly RegisteredCardFixture[];
}

export function createSubject(): OwnCardResolutionContractSubject {
  return createOwnCardResolutionPolicy();
}

function card(
  cardId: string,
  ownerMemberId: string,
  cardCompany: string,
  lastFour: string,
  overrides: Partial<RegisteredCardFixture> = {},
): RegisteredCardFixture {
  return {
    cardId,
    ownerMemberId,
    cardCompany,
    lastFour,
    lifecycleState: "active",
    ...overrides,
  };
}

describe("본인 소유 카드 판정 공개 계약", () => {
  it("[T-CARD-001] 본인 카드가 없으면 타 멤버의 동일 카드 존재 여부와 무관하게 같은 불일치 결과를 반환한다", () => {
    const subject = createSubject();
    const evidence = { companyLabel: "국민", maskedToken: "1234" };

    const noCards = subject.resolve({
      actingMemberId: "member-a",
      evidence,
      cards: [],
    });
    const onlyPartnerCard = subject.resolve({
      actingMemberId: "member-a",
      evidence,
      cards: [card("partner-card", "member-b", "국민", "1234")],
    });

    expect(noCards).toEqual({
      kind: "unmatched",
      reason: "CARD_NOT_REGISTERED_FOR_ACTOR",
    });
    expect(onlyPartnerCard).toEqual(noCards);
  });

  it("[T-CARD-001][ING-SAVE-004] 비교 가능한 mask가 본인의 유일한 카드와 일치하면 등록 카드의 정규 번호를 canonical evidence로 반환한다", () => {
    const result = createSubject().resolve({
      actingMemberId: "member-a",
      evidence: { companyLabel: "국민", maskedToken: "xx34" },
      cards: [
        card("exact", "member-a", "국민", "1234"),
        card("partner", "member-b", "국민", "1234"),
      ],
    });

    expect(result).toEqual({
      kind: "eligible",
      canonicalEvidence: {
        cardId: "exact",
        companyLabel: "국민",
        lastFour: "1234",
      },
    });
  });

  it("[T-CARD-001] exact와 번호 없는 wildcard가 함께 맞으면 exact를 최상위 증거로 선택한다", () => {
    const result = createSubject().resolve({
      actingMemberId: "member-a",
      evidence: { companyLabel: "국민", maskedToken: "1234" },
      cards: [
        card("wildcard", "member-a", "국민", ""),
        card("exact", "member-a", "국민", "1234"),
      ],
    });

    expect(result).toEqual({
      kind: "eligible",
      canonicalEvidence: {
        cardId: "exact",
        companyLabel: "국민",
        lastFour: "1234",
      },
    });
  });

  it("[T-CARD-001] 본인의 wildcard 한 건만 맞아도 허용하지만 없는 번호를 임의로 만들지 않는다", () => {
    const result = createSubject().resolve({
      actingMemberId: "member-a",
      evidence: { companyLabel: "국민", maskedToken: "9876" },
      cards: [card("wildcard", "member-a", "국민", "")],
    });

    expect(result).toEqual({ kind: "eligible" });
  });

  it("[T-CARD-001] 본인 최상위 후보가 여러 건이면 등록은 허용하되 특정 카드를 임의 선택하지 않는다", () => {
    const subject = createSubject();
    const cards = [
      card("exact-a", "member-a", "국민", "1234"),
      card("exact-b", "member-a", "국민", "1234"),
    ];
    const input = {
      actingMemberId: "member-a",
      evidence: { companyLabel: "국민", maskedToken: "1234" },
    };

    const forward = subject.resolve({ ...input, cards });
    const reversed = subject.resolve({ ...input, cards: [...cards].reverse() });

    expect(forward).toEqual({ kind: "eligible" });
    expect(reversed).toEqual(forward);
  });

  it("[T-CARD-001] 퇴역 카드는 본인 카드여도 매칭 후보에서 제외한다", () => {
    const result = createSubject().resolve({
      actingMemberId: "member-a",
      evidence: { companyLabel: "국민", maskedToken: "1234" },
      cards: [
        card("retired", "member-a", "국민", "1234", {
          lifecycleState: "retired",
        }),
      ],
    });

    expect(result).toEqual({
      kind: "unmatched",
      reason: "CARD_NOT_REGISTERED_FOR_ACTOR",
    });
  });

  it("[T-CARD-004] 명시 순서를 먼저 적용하고 순서 없는 일반 카드는 간편결제보다 앞에 둔다", () => {
    const cards = [
      card("quick-pay", "member-a", "네이버페이", ""),
      card("general-2222-b", "member-a", "국민", "2222"),
      card("ordered-9", "member-a", "토스", "", { orderIndex: 9 }),
      card("general-1111", "member-a", "국민", "1111"),
      card("ordered-2", "member-a", "국민", "9999", { orderIndex: 2 }),
      card("general-2222-a", "member-a", "국민", "2222"),
      card("partner", "member-b", "국민", "0000"),
      card("retired", "member-a", "국민", "0001", {
        lifecycleState: "retired",
      }),
    ];

    const result = createSubject().listActiveCards({
      actingMemberId: "member-a",
      cards,
    });

    expect(result.map((item) => item.cardId)).toEqual([
      "ordered-2",
      "ordered-9",
      "general-1111",
      "general-2222-a",
      "general-2222-b",
      "quick-pay",
    ]);
  });

  it("[T-CARD-004] 입력 배열 순서가 달라도 같은 결정 순서를 반환한다", () => {
    const subject = createSubject();
    const cards = [
      card("quick-pay", "member-a", "네이버페이", ""),
      card("general-b", "member-a", "국민", "2222"),
      card("general-a", "member-a", "국민", "1111"),
    ];

    const forward = subject.listActiveCards({
      actingMemberId: "member-a",
      cards,
    });
    const reversed = subject.listActiveCards({
      actingMemberId: "member-a",
      cards: [...cards].reverse(),
    });

    expect(reversed).toEqual(forward);
  });
});

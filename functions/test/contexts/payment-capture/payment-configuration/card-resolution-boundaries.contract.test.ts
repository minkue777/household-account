import { describe, expect, it } from "vitest";
import {
  createCardResolutionBoundaryDriver,
  type CardResolutionBoundaryState,
  type CardResolutionLookup,
  type CardResolutionRecord,
  type PaymentCardResolutionInputPort,
} from "../../../support/card-resolution-boundary-driver";

export interface CardResolutionBoundariesSubject
  extends PaymentCardResolutionInputPort {
  state(): CardResolutionBoundaryState;
}

export function createSubject(
  lookup: CardResolutionLookup = { kind: "Available", cards: [] },
): CardResolutionBoundariesSubject {
  return createCardResolutionBoundaryDriver(lookup);
}

function card(
  cardId: string,
  companyLabel: string,
  lastFour?: string,
): CardResolutionRecord {
  return {
    cardId,
    ownerMemberId: "member-a",
    companyLabel,
    lastFour,
    lifecycle: "active",
  };
}

describe("본인 카드 label·mask·도시가스·장애 경계 공개 계약", () => {
  it.each([
    {
      name: "여민전 parser와 세종 등록 라벨",
      parsedEvidence: { companyLabel: "여민전", maskedToken: "1234" },
      registered: card("card-sejong", "세종", "1234"),
    },
    {
      name: "세종 parser와 여민전 등록 라벨",
      parsedEvidence: { companyLabel: "세종", maskedToken: "**-**1234" },
      registered: card("card-yeomin", "여민전", "1234"),
    },
    {
      name: "숫자가 섞인 mask의 마지막 네 자리",
      parsedEvidence: { companyLabel: "국민", maskedToken: "1234-****-****-5678" },
      registered: card("card-kb", "국민", "5678"),
    },
  ])(
    "[T-CARD-001][CARD-004][ING-SAVE-003] $name를 같은 카드 계약으로 판정한다",
    async ({ parsedEvidence, registered }) => {
      const subject = createSubject({
        kind: "Available",
        cards: [registered],
      });

      expect(
        await subject.resolve({
          sourceKind: "payment",
          actingMemberId: "member-a",
          parsedEvidence,
        }),
      ).toEqual({ kind: "Eligible", canonicalCardId: registered.cardId });
      expect(subject.state()).toEqual({ lookupAttempts: 1 });
    },
  );

  it("[T-CARD-001][CARD-004][ING-SAVE-003] 도시가스는 카드 Repository가 불가해도 조회 없이 명시적 예외로 통과한다", async () => {
    const subject = createSubject({
      kind: "Unavailable",
      code: "CARD_REPOSITORY_UNAVAILABLE",
    });

    expect(
      await subject.resolve({
        sourceKind: "city-gas",
        actingMemberId: "member-a",
        parsedEvidence: { companyLabel: "도시가스" },
      }),
    ).toEqual({ kind: "Bypassed", reason: "CITY_GAS" });
    expect(subject.state()).toEqual({ lookupAttempts: 0 });
  });

  it("[T-CARD-001][CARD-004] Repository 장애를 카드 미등록으로 축약하지 않는다", async () => {
    const subject = createSubject({
      kind: "Unavailable",
      code: "CARD_REPOSITORY_UNAVAILABLE",
    });

    expect(
      await subject.resolve({
        sourceKind: "payment",
        actingMemberId: "member-a",
        parsedEvidence: { companyLabel: "국민", maskedToken: "1234" },
      }),
    ).toEqual({
      kind: "RetryableFailure",
      code: "CARD_REPOSITORY_UNAVAILABLE",
    });
    expect(subject.state()).toEqual({ lookupAttempts: 1 });
  });

  it("[T-CARD-001][CARD-004][ING-SAVE-003] 본인 활성 카드가 없으면 타 멤버·퇴역 카드 존재 여부를 노출하지 않고 같은 불일치다", async () => {
    const evidence = {
      sourceKind: "payment" as const,
      actingMemberId: "member-a",
      parsedEvidence: { companyLabel: "국민", maskedToken: "1234" },
    };
    const snapshots: readonly CardResolutionLookup[] = [
      { kind: "Available", cards: [] },
      {
        kind: "Available",
        cards: [
          {
            ...card("partner-card", "국민", "1234"),
            ownerMemberId: "member-b",
          },
        ],
      },
      {
        kind: "Available",
        cards: [
          {
            ...card("retired-card", "국민", "1234"),
            lifecycle: "retired",
          },
        ],
      },
    ];

    const results = await Promise.all(
      snapshots.map((snapshot) => createSubject(snapshot).resolve(evidence)),
    );

    expect(results).toEqual([
      {
        kind: "Unmatched",
        code: "CARD_NOT_REGISTERED_FOR_ACTOR",
      },
      {
        kind: "Unmatched",
        code: "CARD_NOT_REGISTERED_FOR_ACTOR",
      },
      {
        kind: "Unmatched",
        code: "CARD_NOT_REGISTERED_FOR_ACTOR",
      },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import {
  createShortcutPaymentRecordingDriver,
  type ShortcutPaymentRecordingDriver,
} from "../../../support/shortcut-payment-recording-driver";

export interface ShortcutPaymentRecordingSubject
  extends ShortcutPaymentRecordingDriver {}

export function createSubject(
  fixture: { readonly commitAvailable?: boolean } = {},
): ShortcutPaymentRecordingSubject {
  return createShortcutPaymentRecordingDriver(fixture);
}

const actor = { householdId: "household-a", memberId: "member-a" };
const parsed = {
  amountInWon: 10_000,
  merchant: "가맹점가",
  cardEvidence: { companyLabel: "국민", maskedToken: "1234" },
};

describe("Shortcut 본인 카드 확인·거래 최종 상태 공개 계약", () => {
  it("[T-CARD-001][T-IOS-002][IOS-007] 본인 카드 0건이면 거래·알림을 만들지 않는다", async () => {
    const subject = createSubject();

    expect(
      await subject.record({
        commandId: "command-none",
        actor,
        parsed,
        defaultCategory: { kind: "Found", categoryId: "category-default" },
        cards: [
          {
            cardId: "card-partner",
            householdId: "household-a",
            ownerMemberId: "member-b",
            companyLabel: "국민",
            lifecycle: "active",
          },
        ],
      }),
    ).toEqual({
      kind: "Rejected",
      code: "CARD_NOT_REGISTERED_FOR_ACTOR",
    });
    expect(subject.state()).toEqual({ transactions: [], outboxEventIds: [] });
  });

  it("[T-CARD-001][T-IOS-001][IOS-007] 본인 카드 한 건이면 기본 카테고리·빈 memo·creator·source·파싱 카드 증거를 함께 저장한다", async () => {
    const subject = createSubject();

    const result = await subject.record({
      commandId: "command-one",
      actor,
      parsed,
      defaultCategory: { kind: "Found", categoryId: "category-default" },
      cards: [
        {
          cardId: "card-a",
          householdId: "household-a",
          ownerMemberId: "member-a",
          companyLabel: "국민",
          lastFour: "1234",
          lifecycle: "active",
        },
      ],
    });

    expect(result).toEqual({
      kind: "Created",
      transactionId: expect.any(String),
    });
    if (result.kind !== "Created") throw new Error("Created 결과가 필요합니다.");
    expect(subject.state().transactions).toEqual([
      {
        transactionId: result.transactionId,
        householdId: "household-a",
        creatorMemberId: "member-a",
        transactionType: "expense",
        categoryId: "category-default",
        memo: "",
        source: "ios-shortcut",
        amountInWon: 10_000,
        merchant: "가맹점가",
        cardEvidence: { companyLabel: "국민", maskedToken: "1234" },
        selectedRegisteredCardId: "card-a",
      },
    ]);
    expect(subject.state().outboxEventIds).toEqual([
      "command-one:transaction-recorded",
    ]);
  });

  it("[T-CARD-001][IOS-007] 본인 최상위 후보가 여러 건 맞아도 생성하며 임의 카드 ID 대신 parser 증거를 유지한다", async () => {
    const subject = createSubject();

    expect(
      await subject.record({
        commandId: "command-multiple",
        actor,
        parsed,
        defaultCategory: { kind: "Found", categoryId: "category-default" },
        cards: [
          {
            cardId: "card-exact-a",
            householdId: "household-a",
            ownerMemberId: "member-a",
            companyLabel: "국민",
            lastFour: "1234",
            lifecycle: "active",
          },
          {
            cardId: "card-exact-b",
            householdId: "household-a",
            ownerMemberId: "member-a",
            companyLabel: "국민",
            lastFour: "1234",
            lifecycle: "active",
          },
        ],
      }),
    ).toMatchObject({ kind: "Created" });
    expect(subject.state().transactions[0]).toMatchObject({
      cardEvidence: parsed.cardEvidence,
    });
    expect(subject.state().transactions[0]).not.toHaveProperty(
      "selectedRegisteredCardId",
    );
  });

  it("[T-CARD-001][IOS-007] exact 한 건과 wildcard가 함께 있으면 더 구체적인 exact 카드만 정규 증거로 선택한다", async () => {
    const subject = createSubject();

    await subject.record({
      commandId: "command-exact-over-wildcard",
      actor,
      parsed,
      defaultCategory: { kind: "Found", categoryId: "category-default" },
      cards: [
        {
          cardId: "card-wildcard",
          householdId: "household-a",
          ownerMemberId: "member-a",
          companyLabel: "국민",
          lifecycle: "active",
        },
        {
          cardId: "card-exact",
          householdId: "household-a",
          ownerMemberId: "member-a",
          companyLabel: "국민",
          lastFour: "1234",
          lifecycle: "active",
        },
      ],
    });

    expect(subject.state().transactions[0]).toMatchObject({
      cardEvidence: parsed.cardEvidence,
      selectedRegisteredCardId: "card-exact",
    });
  });

  it.each([
    {
      name: "같은 memberId여도 다른 가구 카드",
      card: {
        cardId: "other-household-card",
        householdId: "household-b",
        ownerMemberId: "member-a",
        companyLabel: "국민",
        lastFour: "1234",
        lifecycle: "active" as const,
      },
    },
    {
      name: "현재 가구·본인 카드여도 퇴역 카드",
      card: {
        cardId: "retired-card",
        householdId: "household-a",
        ownerMemberId: "member-a",
        companyLabel: "국민",
        lastFour: "1234",
        lifecycle: "retired" as const,
      },
    },
  ])(
    "[T-CARD-001][IOS-007] $name는 결제 등록 권한의 근거가 아니다",
    async ({ card }) => {
      const subject = createSubject();

      expect(
        await subject.record({
          commandId: `command-ineligible-${card.cardId}`,
          actor,
          parsed,
          defaultCategory: { kind: "Found", categoryId: "category-default" },
          cards: [card],
        }),
      ).toEqual({
        kind: "Rejected",
        code: "CARD_NOT_REGISTERED_FOR_ACTOR",
      });
      expect(subject.state()).toEqual({ transactions: [], outboxEventIds: [] });
    },
  );

  it.each([
    {
      name: "기본 카테고리 없음",
      defaultCategory: { kind: "Missing" } as const,
      expected: { kind: "Rejected", code: "DEFAULT_CATEGORY_UNAVAILABLE" } as const,
    },
    {
      name: "기준 데이터 Port 장애",
      defaultCategory: { kind: "Unavailable" } as const,
      expected: { kind: "RetryableFailure", code: "REFERENCE_DATA_UNAVAILABLE" } as const,
    },
  ])(
    "[T-IOS-002][IOS-007] $name은 빈 category로 거래를 만들지 않는다",
    async ({ defaultCategory, expected }) => {
      const subject = createSubject();

      expect(
        await subject.record({
          commandId: "command-category-failure",
          actor,
          parsed,
          defaultCategory,
          cards: [
            {
              cardId: "card-a",
              householdId: "household-a",
              ownerMemberId: "member-a",
              companyLabel: "국민",
              lastFour: "1234",
              lifecycle: "active",
            },
          ],
        }),
      ).toEqual(expected);
      expect(subject.state()).toEqual({ transactions: [], outboxEventIds: [] });
    },
  );

  it("[T-IOS-002][IOS-007] Found 결과라도 categoryId가 비어 있으면 불완전한 거래를 저장하지 않는다", async () => {
    const subject = createSubject();

    expect(
      await subject.record({
        commandId: "command-blank-category",
        actor,
        parsed,
        defaultCategory: { kind: "Found", categoryId: "   " },
        cards: [
          {
            cardId: "card-a",
            householdId: "household-a",
            ownerMemberId: "member-a",
            companyLabel: "국민",
            lastFour: "1234",
            lifecycle: "active",
          },
        ],
      }),
    ).toEqual({
      kind: "Rejected",
      code: "DEFAULT_CATEGORY_UNAVAILABLE",
    });
    expect(subject.state()).toEqual({ transactions: [], outboxEventIds: [] });
  });

  it("[T-CARD-001][IOS-007] 카드 기준 데이터 장애는 미등록으로 축약하지 않고 재시도 가능 실패로 구분한다", async () => {
    const subject = createSubject();

    expect(
      await subject.record({
        commandId: "command-card-reference-failure",
        actor,
        parsed,
        defaultCategory: { kind: "Found", categoryId: "category-default" },
        cards: { kind: "Unavailable" },
      }),
    ).toEqual({
      kind: "RetryableFailure",
      code: "REFERENCE_DATA_UNAVAILABLE",
    });
    expect(subject.state()).toEqual({ transactions: [], outboxEventIds: [] });
  });

  it("[T-IOS-002][IOS-007][IOS-008] 거래·Outbox 원자 commit이 실패하면 어느 쪽도 일부 저장하지 않는다", async () => {
    const subject = createSubject({ commitAvailable: false });

    expect(
      await subject.record({
        commandId: "command-commit-failure",
        actor,
        parsed,
        defaultCategory: { kind: "Found", categoryId: "category-default" },
        cards: [
          {
            cardId: "card-a",
            householdId: "household-a",
            ownerMemberId: "member-a",
            companyLabel: "국민",
            lastFour: "1234",
            lifecycle: "active",
          },
        ],
      }),
    ).toEqual({
      kind: "RetryableFailure",
      code: "TRANSACTION_COMMIT_UNAVAILABLE",
    });
    expect(subject.state()).toEqual({ transactions: [], outboxEventIds: [] });
  });

  it("[T-IOS-002][IOS-011] 같은 command 재실행은 최초 결과를 재생하고 거래·Outbox를 중복 저장하지 않는다", async () => {
    const subject = createSubject();
    const input = {
      commandId: "command-replay",
      actor,
      parsed,
      defaultCategory: {
        kind: "Found" as const,
        categoryId: "category-default",
      },
      cards: [
        {
          cardId: "card-a",
          householdId: "household-a",
          ownerMemberId: "member-a",
          companyLabel: "국민",
          lastFour: "1234",
          lifecycle: "active" as const,
        },
      ],
    };

    const first = await subject.record(input);
    const replay = await subject.record(input);

    expect(replay).toEqual(first);
    expect(subject.state().transactions).toHaveLength(1);
    expect(subject.state().outboxEventIds).toEqual([
      "command-replay:transaction-recorded",
    ]);
  });

  it("[T-IOS-OWNER-LEGACY-001][IOS-007] 1876 별도 cardType은 목표 Writer가 아닌 legacy characterization에만 남는다", () => {
    const subject = createSubject();

    expect(
      subject.characterizeLegacyCardType({
        companyLabel: "삼성",
        maskedToken: "****-****-****-1876",
      }),
    ).toEqual({ kind: "LegacyOnly", cardType: "legacy-samsung-1876" });
    expect(
      subject.characterizeLegacyCardType({
        companyLabel: "삼성",
        maskedToken: "9999",
      }),
    ).toEqual({ kind: "LegacyOnly", cardType: null });
    expect(
      subject.characterizeLegacyCardType({
        companyLabel: "국민",
        maskedToken: "1876",
      }),
    ).toEqual({ kind: "LegacyOnly", cardType: null });
  });
});

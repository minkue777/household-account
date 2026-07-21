import { describe, expect, it } from "vitest";

import type {
  RegisterCardCommand,
  RegisteredCardActor,
  RegisteredCardView,
} from "../../../../src/contexts/payment-capture/configuration/public";
import {
  createRegisteredCardManagementDriver,
  type HistoricalCardEvidence,
  type RegisteredCardManagementDriver,
} from "../../../support/registered-card-management-driver";

export interface RegisteredCardManagementContractSubject
  extends RegisteredCardManagementDriver {}

export function createSubject(fixture?: {
  cards?: readonly RegisteredCardView[];
  historicalCaptureEvidence?: readonly HistoricalCardEvidence[];
}): RegisteredCardManagementContractSubject {
  return createRegisteredCardManagementDriver(fixture);
}

const actor: RegisteredCardActor = {
  householdId: "household-1",
  memberId: "member-1",
};

const activeCard = (
  overrides: Partial<RegisteredCardView> = {},
): RegisteredCardView => ({
  cardId: "card-1",
  householdId: "household-1",
  ownerMemberId: "member-1",
  cardCompany: "samsung",
  lastFour: "1234",
  orderIndex: 0,
  lifecycleState: "active",
  version: 1,
  ...overrides,
});

const registerCommand = (
  commandId: string,
  overrides: Partial<RegisterCardCommand> = {},
): RegisterCardCommand => ({
  commandId,
  actor,
  householdId: "household-1",
  ownerMemberId: "member-1",
  cardCompany: "samsung",
  cardNumber: "1234",
  ...overrides,
});

describe("등록 카드 정규화·동시 유일성·퇴역 공개 계약", () => {
  it("[T-CARD-002][CARD-001] 긴 카드 번호에서 숫자 마지막 네 자리만 저장한다", async () => {
    const subject = createSubject();

    const result = await subject.register(
      registerCommand("command-1", { cardNumber: "1234-5678 9012-3456" }),
    );

    expect(result).toMatchObject({
      kind: "Registered",
      card: {
        householdId: "household-1",
        ownerMemberId: "member-1",
        cardCompany: "samsung",
        lastFour: "3456",
        lifecycleState: "active",
      },
    });
    expect(subject.state().cardRecords).toHaveLength(1);
    expect(subject.state().cardRecords[0]).not.toHaveProperty("cardNumber");
    expect(subject.state().activeClaims).toEqual([
      expect.objectContaining({
        ownerMemberId: "member-1",
        cardCompany: "samsung",
        lastFour: "3456",
      }),
    ]);
  });

  it.each([
    { name: "끝 번호가 있는 카드", cardNumber: "1234" },
    { name: "번호 없는 wildcard 카드", cardNumber: undefined },
  ])(
    "[T-CARD-003][CARD-002] 같은 소유자의 동일 $name 등록 명령이 경합해도 카드와 claim은 하나만 남는다",
    async ({ cardNumber }) => {
      const subject = createSubject();

      const results = await subject.registerConcurrently([
        registerCommand("command-a", { cardNumber }),
        registerCommand("command-b", { cardNumber }),
      ]);

      expect(results.map(({ kind }) => kind).sort()).toEqual([
        "Duplicate",
        "Registered",
      ]);
      expect(subject.state().cardRecords).toHaveLength(1);
      expect(subject.state().activeClaims).toHaveLength(1);
      expect(subject.state().activeClaims[0].lastFour).toBe(cardNumber ?? "");
      const duplicate = results.find(({ kind }) => kind === "Duplicate");
      expect(duplicate).toMatchObject({
        kind: "Duplicate",
        existingCardId: subject.state().cardRecords[0].cardId,
      });
    },
  );

  it.each([
    {
      name: "요청 가구와 Actor 가구가 다를 때",
      command: registerCommand("foreign-household", {
        actor: { ...actor, householdId: "household-2" },
      }),
      expected: { kind: "Forbidden", code: "HOUSEHOLD_FORBIDDEN" } as const,
    },
    {
      name: "본인이 아닌 소유자로 등록할 때",
      command: registerCommand("foreign-owner", {
        ownerMemberId: "member-2",
      }),
      expected: { kind: "Forbidden", code: "OWNER_FORBIDDEN" } as const,
    },
  ])(
    "[T-CARD-005][CARD-005] $name 카드와 claim을 만들지 않는다",
    async ({ command, expected }) => {
      const subject = createSubject();

      expect(await subject.register(command)).toEqual(expected);
      expect(subject.state().cardRecords).toEqual([]);
      expect(subject.state().activeClaims).toEqual([]);
    },
  );

  it("[T-CARD-004][CARD-003/CARD-005] 활성 본인 카드만 가구 안에서 입력 순서와 무관하게 결정 정렬한다", () => {
    const cards = [
      activeCard({
        cardId: "quick",
        cardCompany: "네이버페이",
        lastFour: "",
        orderIndex: undefined,
      }),
      activeCard({ cardId: "general-b", lastFour: "2222", orderIndex: undefined }),
      activeCard({ cardId: "ordered-2", lastFour: "9999", orderIndex: 2 }),
      activeCard({ cardId: "general-a", lastFour: "1111", orderIndex: undefined }),
      activeCard({ cardId: "ordered-1", lastFour: "8888", orderIndex: 1 }),
      activeCard({ cardId: "other-owner", ownerMemberId: "member-2" }),
      activeCard({ cardId: "other-household", householdId: "household-2" }),
      activeCard({ cardId: "retired", lifecycleState: "retired" }),
    ];

    const forward = createSubject({ cards }).listActive(actor);
    const reversed = createSubject({ cards: [...cards].reverse() }).listActive(actor);

    expect(forward.map(({ cardId }) => cardId)).toEqual([
      "ordered-1",
      "ordered-2",
      "general-a",
      "general-b",
      "quick",
    ]);
    expect(reversed).toEqual(forward);
  });

  it.each([
    {
      name: "소유자",
      change: { requestedOwnerMemberId: "member-2" },
    },
    {
      name: "카드사",
      change: { requestedCardCompany: "kb" },
    },
  ])(
    "[T-CARD-005][CARD-005] 기존 카드의 $name identity 변경은 write 0건으로 거부한다",
    async ({ change }) => {
      const card = activeCard();
      const subject = createSubject({ cards: [card] });

      expect(
        await subject.update({
          actor,
          cardId: card.cardId,
          expectedVersion: card.version,
          ...change,
        }),
      ).toEqual({
        kind: "Rejected",
        code: "CARD_IDENTITY_CHANGE_REQUIRES_REREGISTRATION",
      });
      expect(subject.state().cardRecords).toEqual([card]);
      expect(subject.state().activeClaims).toEqual([
        {
          ownerMemberId: "member-1",
          cardCompany: "samsung",
          lastFour: "1234",
          cardId: "card-1",
        },
      ]);
    },
  );

  it("[T-CARD-005][CARD-005] 사용자 자유 입력 카드 별칭은 모델에 추가하지 않고 write 0건으로 거부한다", async () => {
    const card = activeCard();
    const subject = createSubject({ cards: [card] });

    expect(
      await subject.update({
        actor,
        cardId: card.cardId,
        expectedVersion: card.version,
        customAlias: "생활비 카드",
      }),
    ).toEqual({
      kind: "Rejected",
      code: "CUSTOM_CARD_ALIAS_NOT_SUPPORTED",
    });
    expect(subject.state().cardRecords).toEqual([card]);
  });

  it("[T-CARD-005][CARD-005] 타 가구·타 소유자 Actor는 카드 ID를 알아도 수정하거나 퇴역할 수 없다", async () => {
    const card = activeCard();
    const subject = createSubject({ cards: [card] });
    const before = subject.state();

    expect(
      await subject.update({
        actor: { ...actor, householdId: "household-2" },
        cardId: card.cardId,
        expectedVersion: card.version,
        lastFour: "9876",
      }),
    ).toEqual({ kind: "Forbidden", code: "HOUSEHOLD_FORBIDDEN" });
    expect(
      await subject.retire({
        actor: { ...actor, memberId: "member-2" },
        cardId: card.cardId,
        expectedVersion: card.version,
      }),
    ).toEqual({ kind: "Forbidden", code: "OWNER_FORBIDDEN" });
    expect(subject.state()).toEqual(before);
  });

  it("[T-CARD-005][CARD-005] 끝 번호 변경은 새 claim·card version·이전 claim 해제를 한 번에 확정한다", async () => {
    const subject = createSubject({ cards: [activeCard()] });

    const result = await subject.update({
      actor,
      cardId: "card-1",
      expectedVersion: 1,
      lastFour: "98-76",
    });

    expect(result).toMatchObject({
      kind: "Updated",
      card: { lastFour: "9876", version: 2 },
    });
    expect(subject.state().cardRecords).toEqual([
      activeCard({ lastFour: "9876", version: 2 }),
    ]);
    expect(subject.state().activeClaims).toEqual([
      {
        ownerMemberId: "member-1",
        cardCompany: "samsung",
        lastFour: "9876",
        cardId: "card-1",
      },
    ]);
  });

  it.each([
    { name: "stale version", expectedVersion: 0, lastFour: "9876", code: "VERSION_MISMATCH" },
    { name: "이미 다른 카드가 점유한 번호", expectedVersion: 1, lastFour: "5678", code: undefined },
  ])(
    "[T-CARD-005][CARD-005] $name 수정은 카드와 claim을 모두 원상 유지한다",
    async ({ expectedVersion, lastFour, code }) => {
      const cards = [
        activeCard(),
        activeCard({ cardId: "card-2", lastFour: "5678", orderIndex: 1 }),
      ];
      const subject = createSubject({ cards });

      const result = await subject.update({
        actor,
        cardId: "card-1",
        expectedVersion,
        lastFour,
      });

      if (code) {
        expect(result).toEqual({ kind: "Conflict", code });
      } else {
        expect(result).toEqual({ kind: "Duplicate", existingCardId: "card-2" });
      }
      expect(subject.state().cardRecords).toEqual(cards);
      expect(subject.state().activeClaims).toHaveLength(2);
    },
  );

  it("[T-CARD-005][CARD-005] 퇴역 카드는 목록·매칭·claim에서 제외하지만 카드 문서와 과거 capture 증거는 보존한다", async () => {
    const evidence: HistoricalCardEvidence = {
      transactionId: "transaction-1",
      cardId: "card-1",
      cardCompany: "samsung",
      lastFour: "1234",
    };
    const subject = createSubject({
      cards: [activeCard()],
      historicalCaptureEvidence: [evidence],
    });

    expect(
      await subject.retire({ actor, cardId: "card-1", expectedVersion: 1 }),
    ).toMatchObject({
      kind: "Retired",
      card: { cardId: "card-1", lifecycleState: "retired", version: 2 },
    });
    expect(subject.listActive(actor)).toEqual([]);
    expect(
      subject.resolve({
        actor,
        cardCompany: "samsung",
        cardToken: "1234",
      }),
    ).toEqual({ kind: "Unmatched" });
    expect(subject.state()).toMatchObject({
      cardRecords: [
        expect.objectContaining({ cardId: "card-1", lifecycleState: "retired" }),
      ],
      activeClaims: [],
      historicalCaptureEvidence: [evidence],
    });
  });
});

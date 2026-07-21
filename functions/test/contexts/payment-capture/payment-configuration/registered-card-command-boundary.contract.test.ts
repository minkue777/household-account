import { describe, expect, it } from "vitest";

import { createRegisteredCardCommandBoundaryFixture } from "../../../support/registered-card-command-boundary-fixture";

interface CardActor {
  principalUid: string;
  householdId: string;
  memberId: string;
  capability: "paymentConfiguration:manage";
}

interface RegisteredCardRecord {
  cardId: string;
  householdId: string;
  ownerMemberId: string;
  cardCompanyCode: string;
  lastFour?: string;
  order: number;
  version: number;
  lifecycle: "active" | "retired";
}

interface HistoricalCardEvidence {
  transactionId: string;
  householdId: string;
  cardCompanyLabel: string;
  lastFour?: string;
}

type CardCommandResult =
  | { kind: "Created" | "Updated" | "Retired"; card: RegisteredCardRecord }
  | { kind: "Reordered"; orderedCardIds: readonly string[]; collectionVersion: number }
  | { kind: "NotFound" }
  | { kind: "Forbidden"; code: "HOUSEHOLD_FORBIDDEN" | "OWNER_FORBIDDEN" }
  | { kind: "Conflict"; code: "VERSION_MISMATCH" | "DUPLICATE_CARD" }
  | {
      kind: "Rejected";
      code:
        | "INVALID_LAST_FOUR"
        | "INCOMPLETE_CARD_SET"
        | "DUPLICATE_CARD_ID"
        | "FOREIGN_CARD_ID";
    }
  | { kind: "RetryableFailure"; code: "ATOMIC_COMMIT_FAILED" };

interface RegisteredCardCommandState {
  cards: readonly RegisteredCardRecord[];
  claims: readonly {
    householdId: string;
    ownerMemberId: string;
    cardCompanyCode: string;
    lastFour?: string;
    cardId: string;
  }[];
  historicalEvidence: readonly HistoricalCardEvidence[];
  collectionVersions: Readonly<Record<string, number>>;
}

export interface RegisteredCardCommandBoundarySubject {
  register(input: {
    actor: CardActor;
    ownerMemberId: string;
    cardId: string;
    cardCompanyCode: string;
    rawLastFour?: string;
  }): CardCommandResult;
  updateLastFour(input: {
    actor: CardActor;
    cardId: string;
    rawLastFour?: string;
    expectedVersion: number;
    commitOutcome?: "success" | "failure";
  }): CardCommandResult;
  retire(input: {
    actor: CardActor;
    cardId: string;
    expectedVersion: number;
    commitOutcome?: "success" | "failure";
  }): CardCommandResult;
  reorder(input: {
    actor: CardActor;
    ownerMemberId: string;
    orderedCardIds: readonly string[];
    expectedCollectionVersion: number;
    commitOutcome?: "success" | "failure";
  }): CardCommandResult;
  searchHistorical(input: {
    actor: CardActor;
    query: string;
  }): readonly HistoricalCardEvidence[];
  availableCommands(): readonly string[];
  state(): RegisteredCardCommandState;
}

export function createSubject(fixture?: {
  cards?: readonly RegisteredCardRecord[];
  historicalEvidence?: readonly HistoricalCardEvidence[];
  collectionVersions?: Readonly<Record<string, number>>;
}): RegisteredCardCommandBoundarySubject {
  return createRegisteredCardCommandBoundaryFixture(fixture);
}

const actor: CardActor = {
  principalUid: "uid-a",
  householdId: "household-a",
  memberId: "member-a",
  capability: "paymentConfiguration:manage",
};

function card(
  cardId: string,
  order: number,
  overrides: Partial<RegisteredCardRecord> = {},
): RegisteredCardRecord {
  return {
    cardId,
    householdId: "household-a",
    ownerMemberId: "member-a",
    cardCompanyCode: "kb",
    lastFour: cardId.slice(-4).padStart(4, "0"),
    order,
    version: 1,
    lifecycle: "active",
    ...overrides,
  };
}

describe("등록 카드 Command 권한·CRUD·원자 재정렬 공개 계약", () => {
  it("[T-CARD-002][CARD-001] 등록은 숫자 마지막 네 자리만 claim과 카드에 저장한다", () => {
    const subject = createSubject();

    expect(
      subject.register({
        actor,
        ownerMemberId: "member-a",
        cardId: "card-a",
        cardCompanyCode: "kb",
        rawLastFour: "1234-5678-9012-3456",
      }),
    ).toMatchObject({
      kind: "Created",
      card: { lastFour: "3456", ownerMemberId: "member-a" },
    });
    expect(subject.state().claims).toEqual([
      {
        householdId: "household-a",
        ownerMemberId: "member-a",
        cardCompanyCode: "kb",
        lastFour: "3456",
        cardId: "card-a",
      },
    ]);
  });

  it.each(["12", "12A4", "12345"])(
    "[T-CARD-002][CARD-001] 끝 번호 %s는 네 자리 정규값이 아니므로 write 0건이다",
    (rawLastFour) => {
      const subject = createSubject();

      expect(
        subject.register({
          actor,
          ownerMemberId: "member-a",
          cardId: "card-invalid",
          cardCompanyCode: "kb",
          rawLastFour,
        }),
      ).toEqual({ kind: "Rejected", code: "INVALID_LAST_FOUR" });
      expect(subject.state().cards).toEqual([]);
      expect(subject.state().claims).toEqual([]);
    },
  );

  it.each([
    {
      name: "타 가구 actor",
      actor: { ...actor, householdId: "household-b" },
      ownerMemberId: "member-a",
      expected: { kind: "Forbidden", code: "HOUSEHOLD_FORBIDDEN" } as const,
    },
    {
      name: "타 멤버 카드 생성",
      actor,
      ownerMemberId: "member-b",
      expected: { kind: "Forbidden", code: "OWNER_FORBIDDEN" } as const,
    },
  ])(
    "[T-CARD-005][CARD-005] $name은 요청 ID를 신뢰하지 않고 write 0건이다",
    ({ actor: requestActor, ownerMemberId, expected }) => {
      const subject = createSubject();

      expect(
        subject.register({
          actor: requestActor,
          ownerMemberId,
          cardId: "card-forbidden",
          cardCompanyCode: "kb",
          rawLastFour: "1234",
        }),
      ).toEqual(expected);
      expect(subject.state().cards).toEqual([]);
    },
  );

  it("[T-CARD-005][CARD-003][CARD-005] 타 가구 actor는 카드 ID를 알아도 수정·퇴역·재정렬할 수 없다", () => {
    const original = card("card-0001", 0);
    const subject = createSubject({
      cards: [original],
      collectionVersions: { "household-a:member-a": 2 },
    });
    const foreignActor = { ...actor, householdId: "household-b" };
    const before = subject.state();

    expect(
      subject.updateLastFour({
        actor: foreignActor,
        cardId: original.cardId,
        rawLastFour: "9999",
        expectedVersion: 1,
      }),
    ).toEqual({ kind: "Forbidden", code: "HOUSEHOLD_FORBIDDEN" });
    expect(
      subject.retire({
        actor: foreignActor,
        cardId: original.cardId,
        expectedVersion: 1,
      }),
    ).toEqual({ kind: "Forbidden", code: "HOUSEHOLD_FORBIDDEN" });
    expect(
      subject.reorder({
        actor: foreignActor,
        ownerMemberId: "member-a",
        orderedCardIds: [original.cardId],
        expectedCollectionVersion: 2,
      }),
    ).toEqual({ kind: "Forbidden", code: "HOUSEHOLD_FORBIDDEN" });
    expect(subject.state()).toEqual(before);
  });

  it.each([
    {
      name: "수정 NotFound",
      run: (subject: RegisteredCardCommandBoundarySubject) =>
        subject.updateLastFour({
          actor,
          cardId: "missing",
          rawLastFour: "9999",
          expectedVersion: 1,
        }),
    },
    {
      name: "퇴역 NotFound",
      run: (subject: RegisteredCardCommandBoundarySubject) =>
        subject.retire({ actor, cardId: "missing", expectedVersion: 1 }),
    },
  ])("[T-CARD-005][CARD-005] $name는 write 0건이다", ({ run }) => {
    const subject = createSubject();
    const before = subject.state();

    expect(run(subject)).toEqual({ kind: "NotFound" });
    expect(subject.state()).toEqual(before);
  });

  it("[T-CARD-005][CARD-005] 끝 번호 변경 commit 실패는 새 claim·카드 version·이전 claim을 모두 rollback한다", () => {
    const original = card("card-0001", 0, { lastFour: "1234" });
    const subject = createSubject({ cards: [original] });
    const before = subject.state();

    expect(
      subject.updateLastFour({
        actor,
        cardId: original.cardId,
        rawLastFour: "5678",
        expectedVersion: 1,
        commitOutcome: "failure",
      }),
    ).toEqual({ kind: "RetryableFailure", code: "ATOMIC_COMMIT_FAILED" });
    expect(subject.state()).toEqual(before);
  });

  it.each([
    {
      name: "stale version",
      expectedVersion: 0,
      commitOutcome: "success" as const,
      expected: { kind: "Conflict", code: "VERSION_MISMATCH" } as const,
    },
    {
      name: "commit 실패",
      expectedVersion: 1,
      commitOutcome: "failure" as const,
      expected: { kind: "RetryableFailure", code: "ATOMIC_COMMIT_FAILED" } as const,
    },
  ])(
    "[T-CARD-005][CARD-005] 퇴역 $name은 카드·claim을 원상 유지한다",
    ({ expectedVersion, commitOutcome, expected }) => {
      const original = card("card-0001", 0);
      const subject = createSubject({ cards: [original] });
      const before = subject.state();

      expect(
        subject.retire({
          actor,
          cardId: original.cardId,
          expectedVersion,
          commitOutcome,
        }),
      ).toEqual(expected);
      expect(subject.state()).toEqual(before);
    },
  );

  it("[T-CARD-004][CARD-003] 완전한 활성 카드 ID 순서를 고유 order로 원자 저장한다", () => {
    const cards = [card("card-0001", 0), card("card-0002", 1), card("card-0003", 2)];
    const subject = createSubject({
      cards,
      collectionVersions: { "household-a:member-a": 7 },
    });

    expect(
      subject.reorder({
        actor,
        ownerMemberId: "member-a",
        orderedCardIds: ["card-0003", "card-0001", "card-0002"],
        expectedCollectionVersion: 7,
      }),
    ).toEqual({
      kind: "Reordered",
      orderedCardIds: ["card-0003", "card-0001", "card-0002"],
      collectionVersion: 8,
    });
    expect(
      subject.state().cards
        .filter(({ lifecycle }) => lifecycle === "active")
        .sort((left, right) => left.order - right.order)
        .map(({ cardId, order }) => ({ cardId, order })),
    ).toEqual([
      { cardId: "card-0003", order: 0 },
      { cardId: "card-0001", order: 1 },
      { cardId: "card-0002", order: 2 },
    ]);
  });

  it.each([
    {
      name: "일부 ID 누락",
      orderedCardIds: ["card-0001", "card-0002"],
      expected: { kind: "Rejected", code: "INCOMPLETE_CARD_SET" } as const,
    },
    {
      name: "중복 ID",
      orderedCardIds: ["card-0001", "card-0001", "card-0003"],
      expected: { kind: "Rejected", code: "DUPLICATE_CARD_ID" } as const,
    },
    {
      name: "타 소유자 ID",
      orderedCardIds: ["card-0001", "card-0002", "card-other"],
      expected: { kind: "Rejected", code: "FOREIGN_CARD_ID" } as const,
    },
  ])(
    "[T-CARD-004][CARD-003] 재정렬 $name은 부분 order를 남기지 않는다",
    ({ orderedCardIds, expected }) => {
      const cards = [
        card("card-0001", 0),
        card("card-0002", 1),
        card("card-0003", 2),
        card("card-other", 0, { ownerMemberId: "member-b" }),
      ];
      const subject = createSubject({
        cards,
        collectionVersions: { "household-a:member-a": 7 },
      });
      const before = subject.state();

      expect(
        subject.reorder({
          actor,
          ownerMemberId: "member-a",
          orderedCardIds,
          expectedCollectionVersion: 7,
        }),
      ).toEqual(expected);
      expect(subject.state()).toEqual(before);
    },
  );

  it.each([
    {
      name: "stale collection version",
      expectedCollectionVersion: 6,
      commitOutcome: "success" as const,
      expected: { kind: "Conflict", code: "VERSION_MISMATCH" } as const,
    },
    {
      name: "중간 commit 실패",
      expectedCollectionVersion: 7,
      commitOutcome: "failure" as const,
      expected: { kind: "RetryableFailure", code: "ATOMIC_COMMIT_FAILED" } as const,
    },
  ])(
    "[T-CARD-004][CARD-003] $name은 전체 카드 순서와 collection version을 rollback한다",
    ({ expectedCollectionVersion, commitOutcome, expected }) => {
      const subject = createSubject({
        cards: [card("card-0001", 0), card("card-0002", 1)],
        collectionVersions: { "household-a:member-a": 7 },
      });
      const before = subject.state();

      expect(
        subject.reorder({
          actor,
          ownerMemberId: "member-a",
          orderedCardIds: ["card-0002", "card-0001"],
          expectedCollectionVersion,
          commitOutcome,
        }),
      ).toEqual(expected);
      expect(subject.state()).toEqual(before);
    },
  );

  it("[T-CARD-005][CARD-005] 끝 번호 수정·퇴역 뒤에도 과거 거래의 카드사·끝 번호 검색 증거는 변하지 않는다", () => {
    const original = card("card-0001", 0, { lastFour: "1234" });
    const evidence: HistoricalCardEvidence = {
      transactionId: "expense-old",
      householdId: "household-a",
      cardCompanyLabel: "국민",
      lastFour: "1234",
    };
    const subject = createSubject({ cards: [original], historicalEvidence: [evidence] });

    expect(
      subject.updateLastFour({
        actor,
        cardId: original.cardId,
        rawLastFour: "5678",
        expectedVersion: 1,
      }),
    ).toMatchObject({ kind: "Updated", card: { lastFour: "5678" } });
    expect(
      subject.retire({
        actor,
        cardId: original.cardId,
        expectedVersion: 2,
      }),
    ).toMatchObject({ kind: "Retired" });
    expect(subject.searchHistorical({ actor, query: "국민(1234)" })).toEqual([
      evidence,
    ]);
    expect(subject.state().historicalEvidence).toEqual([evidence]);
  });

  it("[T-CARD-005][CARD-005] 공개 Command 목록에는 retired 카드를 일반 사용자가 복구하는 기능이 없다", () => {
    expect(createSubject().availableCommands()).toEqual([
      "RegisterCard",
      "UpdateRegisteredCardLastFour",
      "RetireRegisteredCard",
      "ReorderCards",
    ]);
  });

  it("같은 owner·카드사·끝 번호의 활성 카드는 unique claim 충돌로 중복 등록하지 않는다", () => {
    const original = card("card-0001", 0, { lastFour: "1234" });
    const subject = createSubject({ cards: [original] });
    const before = subject.state();

    expect(
      subject.register({
        actor,
        ownerMemberId: "member-a",
        cardId: "card-duplicate",
        cardCompanyCode: "KB",
        rawLastFour: "1234",
      }),
    ).toEqual({ kind: "Conflict", code: "DUPLICATE_CARD" });
    expect(subject.state()).toEqual(before);
  });

  it("끝 번호가 없는 카드도 owner·카드사 단위 unique claim으로 관리한다", () => {
    const subject = createSubject();

    const created = subject.register({
      actor,
      ownerMemberId: "member-a",
      cardId: "card-wildcard",
      cardCompanyCode: "kb",
    });
    expect(created).toMatchObject({ kind: "Created" });
    if (created.kind === "Created") {
      expect(created.card).not.toHaveProperty("lastFour");
    }
    expect(
      subject.register({
        actor,
        ownerMemberId: "member-a",
        cardId: "card-wildcard-duplicate",
        cardCompanyCode: "kb",
      }),
    ).toEqual({ kind: "Conflict", code: "DUPLICATE_CARD" });
  });

  it("같은 가구의 다른 member도 타인 카드 수정·퇴역을 할 수 없다", () => {
    const original = card("card-0001", 0);
    const subject = createSubject({ cards: [original] });
    const otherMember = { ...actor, memberId: "member-b" };
    const before = subject.state();

    expect(
      subject.updateLastFour({
        actor: otherMember,
        cardId: original.cardId,
        rawLastFour: "9999",
        expectedVersion: 1,
      }),
    ).toEqual({ kind: "Forbidden", code: "OWNER_FORBIDDEN" });
    expect(
      subject.retire({
        actor: otherMember,
        cardId: original.cardId,
        expectedVersion: 1,
      }),
    ).toEqual({ kind: "Forbidden", code: "OWNER_FORBIDDEN" });
    expect(subject.state()).toEqual(before);
  });

  it("끝 번호 수정 성공은 이전 claim을 제거하고 새 claim만 남긴다", () => {
    const subject = createSubject({
      cards: [card("card-0001", 0, { lastFour: "1234" })],
    });

    expect(
      subject.updateLastFour({
        actor,
        cardId: "card-0001",
        rawLastFour: "5678",
        expectedVersion: 1,
      }),
    ).toMatchObject({ kind: "Updated", card: { lastFour: "5678", version: 2 } });
    expect(subject.state().claims).toEqual([
      expect.objectContaining({ cardId: "card-0001", lastFour: "5678" }),
    ]);
  });

  it("퇴역 성공은 활성 unique claim만 제거하고 카드 기록은 보존한다", () => {
    const subject = createSubject({ cards: [card("card-0001", 0)] });

    expect(
      subject.retire({
        actor,
        cardId: "card-0001",
        expectedVersion: 1,
      }),
    ).toMatchObject({ kind: "Retired", card: { lifecycle: "retired", version: 2 } });
    expect(subject.state().claims).toEqual([]);
    expect(subject.state().cards).toHaveLength(1);
  });

  it("과거 카드 증거는 카드사 전체명이나 끝 네 자리만으로도 검색한다", () => {
    const evidence: HistoricalCardEvidence = {
      transactionId: "expense-old",
      householdId: "household-a",
      cardCompanyLabel: "삼성카드",
      lastFour: "3456",
    };
    const subject = createSubject({ historicalEvidence: [evidence] });

    expect(subject.searchHistorical({ actor, query: "삼성카드" })).toEqual([evidence]);
    expect(subject.searchHistorical({ actor, query: "3456" })).toEqual([evidence]);
  });
});

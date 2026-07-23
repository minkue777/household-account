import { describe, expect, it } from "vitest";
import { createBasicLedgerCommandsFixtureSubject } from "../../../support/basic-ledger-commands-fixture";

type TransactionType = "expense" | "income";

interface LedgerTransactionView {
  transactionId: string;
  householdId: string;
  transactionType: TransactionType;
  merchant: string;
  memo: string;
  amountInWon: number;
  categoryId: string;
  accountingDate: string;
  localTime: string;
  cardDisplay: string;
  cardType: "manual" | "captured";
  source?: string;
  creatorMemberId: string;
  lifecycleState: "active" | "deleted";
  aggregateVersion: number;
  notificationRequest?: { requesterMemberId: string; requestedAt: string };
}

type CommandResult =
  | { kind: "success"; value: LedgerTransactionView }
  | { kind: "validation-error"; code: string }
  | { kind: "conflict"; code: string; currentVersion?: number }
  | { kind: "not-found" }
  | { kind: "retryable-failure"; code: string };

type SummaryResult =
  | {
      kind: "success";
      selectedDateAmountInWon: number;
      monthAmountInWon: number;
      yearAmountInWon: number;
      categories: readonly { categoryId: string; amountInWon: number }[];
    }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string };

interface LedgerCommandState {
  transactions: readonly LedgerTransactionView[];
  events: readonly { type: string; transactionId: string; requesterMemberId?: string }[];
}

export interface BasicLedgerCommandsSubject {
  recordManualExpense(input: {
    commandId: string;
    actor: { householdId: string; actingMemberId: string };
    merchant: string;
    amountInWon: number;
    categoryId: string;
    accountingDate: string;
  }): Promise<CommandResult>;
  recordManualIncome(input: {
    commandId: string;
    actor: { householdId: string; actingMemberId: string };
    itemName: string;
    amountInWon: number;
    accountingDate: string;
  }): Promise<CommandResult>;
  update(input: {
    commandId: string;
    actor: { householdId: string; actingMemberId: string };
    transactionId: string;
    expectedVersion: number;
    patch: Partial<Pick<LedgerTransactionView, "merchant" | "memo" | "amountInWon" | "categoryId" | "accountingDate">>;
  }): Promise<CommandResult>;
  delete(input: {
    commandId: string;
    actor: { householdId: string; actingMemberId: string };
    transactionId: string;
    expectedVersion: number;
  }): Promise<CommandResult>;
  summary(input: {
    householdId: string;
    transactionType: TransactionType;
    selectedDate: string;
    yearMonth: string;
    year: number;
  }): Promise<SummaryResult>;
  requestNotification(input: {
    commandId: string;
    actor: { householdId: string; actingMemberId: string };
    transactionId: string;
    expectedVersion: number;
  }): Promise<CommandResult>;
  state(): LedgerCommandState;
}

export function createSubject(fixture: {
  now: string;
  activeCategoryIds?: readonly string[];
  transactions?: readonly LedgerTransactionView[];
  repositoryFailure?: string;
  failNextWrite?: boolean;
}): BasicLedgerCommandsSubject {
  return createBasicLedgerCommandsFixtureSubject(fixture);
}

const actor = { householdId: "house-1", actingMemberId: "member-a" };

const transaction = (
  transactionId: string,
  overrides: Partial<LedgerTransactionView> = {},
): LedgerTransactionView => ({
  transactionId,
  householdId: "house-1",
  transactionType: "expense",
  merchant: "가맹점",
  memo: "",
  amountInWon: 10_000,
  categoryId: "food",
  accountingDate: "2026-07-20",
  localTime: "12:34",
  cardDisplay: "수동",
  cardType: "manual",
  creatorMemberId: "member-a",
  lifecycleState: "active",
  aggregateVersion: 1,
  ...overrides,
});

describe("Ledger 기본 Command·Query 공개 계약", () => {
  it("[T-LED-005][LED-002] 정상 수동 지출만 거래와 Event를 한 번 생성한다", async () => {
    const subject = createSubject({
      now: "2026-07-20T12:34:56+09:00",
      activeCategoryIds: ["food"],
    });

    const result = await subject.recordManualExpense({
      commandId: "expense-1",
      actor,
      merchant: "  식당  ",
      amountInWon: 12_000,
      categoryId: "food",
      accountingDate: "2026-07-19",
    });

    expect(result).toMatchObject({
      kind: "success",
      value: { merchant: "식당", amountInWon: 12_000, categoryId: "food" },
    });
    expect(subject.state().transactions).toHaveLength(1);
    expect(subject.state().events).toEqual([
      { type: "TransactionRecorded.v1", transactionId: expect.any(String) },
    ]);
  });

  it.each([
    ["   ", 10_000, "food", "MERCHANT_REQUIRED"],
    ["식당", 0, "food", "AMOUNT_MUST_BE_POSITIVE_INTEGER"],
    ["식당", -1, "food", "AMOUNT_MUST_BE_POSITIVE_INTEGER"],
    ["식당", 1.5, "food", "AMOUNT_MUST_BE_POSITIVE_INTEGER"],
    ["식당", 10_000, "archived", "CATEGORY_NOT_USABLE"],
  ] as const)(
    "[T-LED-005][LED-002] 잘못된 수동 지출 입력을 %s로 거부하고 write하지 않는다",
    async (merchant, amountInWon, categoryId, code) => {
      const subject = createSubject({
        now: "2026-07-20T12:34:56+09:00",
        activeCategoryIds: ["food"],
      });

      const result = await subject.recordManualExpense({
        commandId: "invalid-expense",
        actor,
        merchant,
        amountInWon,
        categoryId,
        accountingDate: "2026-07-20",
      });

      expect(result).toEqual({ kind: "validation-error", code });
      expect(subject.state()).toEqual({ transactions: [], events: [] });
    },
  );

  it("[T-LED-006][LED-003] 수입 항목명을 memo로 옮기고 고정 표시 필드로 정규화한다", async () => {
    const result = await createSubject({
      now: "2026-07-20T12:34:56+09:00",
    }).recordManualIncome({
      commandId: "income-1",
      actor,
      itemName: "  급여  ",
      amountInWon: 3_000_000,
      accountingDate: "2026-07-20",
    });

    expect(result).toMatchObject({
      kind: "success",
      value: {
        transactionType: "income",
        merchant: "수입",
        categoryId: "etc",
        memo: "급여",
        amountInWon: 3_000_000,
      },
    });
  });

  it.each([
    ["", 10_000, "ITEM_NAME_REQUIRED"],
    ["급여", 0, "AMOUNT_MUST_BE_POSITIVE_INTEGER"],
  ] as const)(
    "[T-LED-006][LED-003] 잘못된 수입 입력은 %s로 거부한다",
    async (itemName, amountInWon, code) => {
      const subject = createSubject({ now: "2026-07-20T12:34:56+09:00" });
      const result = await subject.recordManualIncome({
        commandId: "invalid-income",
        actor,
        itemName,
        amountInWon,
        accountingDate: "2026-07-20",
      });

      expect(result).toEqual({ kind: "validation-error", code });
      expect(subject.state().transactions).toEqual([]);
    },
  );

  it("[T-LED-007][LED-004] 회계일과 무관하게 FixedClock의 HH:mm·manual 카드·인증 Actor를 저장한다", async () => {
    const result = await createSubject({
      now: "2026-07-20T23:45:01+09:00",
      activeCategoryIds: ["food"],
    }).recordManualExpense({
      commandId: "manual-metadata",
      actor,
      merchant: "식당",
      amountInWon: 10_000,
      categoryId: "food",
      accountingDate: "2026-01-01",
    });

    expect(result).toMatchObject({
      kind: "success",
      value: {
        accountingDate: "2026-01-01",
        localTime: "23:45",
        cardType: "manual",
        cardDisplay: "수동",
        creatorMemberId: "member-a",
      },
    });
  });

  it("[T-LED-008][LED-005] 정상 patch만 version을 증가시키고 server field는 입력받지 않는다", async () => {
    const subject = createSubject({
      now: "2026-07-20T12:34:56+09:00",
      transactions: [transaction("tx-1")],
      activeCategoryIds: ["food"],
    });

    const result = await subject.update({
      commandId: "update-1",
      actor,
      transactionId: "tx-1",
      expectedVersion: 1,
      patch: { merchant: "변경", amountInWon: 20_000 },
    });

    expect(result).toMatchObject({
      kind: "success",
      value: { merchant: "변경", amountInWon: 20_000, aggregateVersion: 2 },
    });
  });

  it("[T-LED-008][LED-009] 자동 수집 거래 수정은 원래 수집 출처와 카드 표시를 보존한다", async () => {
    const subject = createSubject({
      now: "2026-07-20T12:34:56+09:00",
      transactions: [
        transaction("captured-1", {
          cardType: "captured",
          cardDisplay: "국민(0027)",
          source: "kb-card",
        }),
      ],
      activeCategoryIds: ["food"],
    });

    await subject.update({
      commandId: "update-captured",
      actor,
      transactionId: "captured-1",
      expectedVersion: 1,
      patch: { categoryId: "food" },
    });

    expect(subject.state().transactions).toEqual([
      expect.objectContaining({
        cardType: "captured",
        cardDisplay: "국민(0027)",
        source: "kb-card",
        aggregateVersion: 2,
      }),
    ]);
  });

  it.each([
    [0, 1, "validation-error", "AMOUNT_MUST_BE_POSITIVE_INTEGER"],
    [20_000, 0, "conflict", "VERSION_MISMATCH"],
  ] as const)(
    "[T-LED-008][LED-005] 잘못된 update는 일부 patch 없이 typed error를 반환한다",
    async (amountInWon, expectedVersion, kind, code) => {
      const original = transaction("tx-1");
      const subject = createSubject({
        now: "2026-07-20T12:34:56+09:00",
        transactions: [original],
      });

      const result = await subject.update({
        commandId: "update-invalid",
        actor,
        transactionId: "tx-1",
        expectedVersion,
        patch: { merchant: "변경되면 안 됨", amountInWon },
      });

      expect(result).toMatchObject({ kind, code });
      expect(subject.state().transactions).toEqual([original]);
    },
  );

  it("[T-LED-008][LED-005][SYS-007] delete 저장 실패는 성공으로 표시하거나 거래를 제거하지 않는다", async () => {
    const original = transaction("tx-1");
    const subject = createSubject({
      now: "2026-07-20T12:34:56+09:00",
      transactions: [original],
      failNextWrite: true,
    });

    const result = await subject.delete({
      commandId: "delete-1",
      actor,
      transactionId: "tx-1",
      expectedVersion: 1,
    });

    expect(result).toEqual({
      kind: "retryable-failure",
      code: "LEDGER_COMMIT_FAILED",
    });
    expect(subject.state().transactions).toEqual([original]);
  });

  it("[T-LED-009][LED-006] active 지출만 선택일·월·연·카테고리 합계에 일관되게 반영한다", async () => {
    const subject = createSubject({
      now: "2026-07-20T12:34:56+09:00",
      transactions: [
        transaction("food-today", { amountInWon: 10_000 }),
        transaction("childcare-month", {
          amountInWon: 20_000,
          categoryId: "childcare",
          accountingDate: "2026-07-01",
        }),
        transaction("food-year", {
          amountInWon: 30_000,
          accountingDate: "2026-01-01",
        }),
        transaction("income", {
          transactionType: "income",
          amountInWon: 99_000,
        }),
        transaction("deleted", {
          lifecycleState: "deleted",
          amountInWon: 88_000,
        }),
      ],
    });

    const result = await subject.summary({
      householdId: "house-1",
      transactionType: "expense",
      selectedDate: "2026-07-20",
      yearMonth: "2026-07",
      year: 2026,
    });

    expect(result).toEqual({
      kind: "success",
      selectedDateAmountInWon: 10_000,
      monthAmountInWon: 30_000,
      yearAmountInWon: 60_000,
      categories: [
        { categoryId: "food", amountInWon: 40_000 },
        { categoryId: "childcare", amountInWon: 20_000 },
      ],
    });
  });

  it("[T-LED-009][LED-006] 원천 실패를 0원 합계로 축약하지 않는다", async () => {
    const result = await createSubject({
      now: "2026-07-20T12:34:56+09:00",
      repositoryFailure: "LEDGER_REPOSITORY_UNAVAILABLE",
    }).summary({
      householdId: "house-1",
      transactionType: "expense",
      selectedDate: "2026-07-20",
      yearMonth: "2026-07",
      year: 2026,
    });

    expect(result).toEqual({
      kind: "retryable-failure",
      code: "LEDGER_REPOSITORY_UNAVAILABLE",
    });
  });

  it("[T-LED-010][LED-007][DEC-013][DEC-022] expense 알림 요청은 인증 requester와 시각·Event를 한 번 기록한다", async () => {
    const subject = createSubject({
      now: "2026-07-20T12:34:56+09:00",
      transactions: [transaction("tx-1", { creatorMemberId: "member-b" })],
    });
    const command = {
      commandId: "notify-1",
      actor,
      transactionId: "tx-1",
      expectedVersion: 1,
    };

    const first = await subject.requestNotification(command);
    const replay = await subject.requestNotification(command);

    expect(first).toMatchObject({
      kind: "success",
      value: {
        notificationRequest: {
          requesterMemberId: "member-a",
          requestedAt: "2026-07-20T12:34:56+09:00",
        },
      },
    });
    expect(replay).toEqual(first);
    expect(subject.state().events).toEqual([
      {
        type: "HouseholdNotificationRequested.v1",
        transactionId: "tx-1",
        requesterMemberId: "member-a",
      },
    ]);
  });

  it("[T-LED-010][LED-007] income에서는 명시적 가구 알림 요청을 거부한다", async () => {
    const income = transaction("income-1", { transactionType: "income" });
    const subject = createSubject({
      now: "2026-07-20T12:34:56+09:00",
      transactions: [income],
    });

    const result = await subject.requestNotification({
      commandId: "notify-income",
      actor,
      transactionId: "income-1",
      expectedVersion: 1,
    });

    expect(result).toEqual({
      kind: "validation-error",
      code: "NOTIFICATION_REQUEST_EXPENSE_ONLY",
    });
    expect(subject.state().transactions).toEqual([income]);
    expect(subject.state().events).toEqual([]);
  });
});

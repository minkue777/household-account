import { describe, expect, it } from "vitest";

import { createQuickEditCommandOutcomeFixture } from "../../../support/quick-edit-command-outcome-fixture";

export interface QuickEditTransactionView {
  transactionId: string;
  merchant: string;
  amountInWon: number;
  categoryId: string;
  memo: string;
  aggregateVersion: number;
}

export type QuickEditOperation =
  | {
      kind: "Update";
      form: Pick<
        QuickEditTransactionView,
        "merchant" | "amountInWon" | "categoryId" | "memo"
      >;
    }
  | { kind: "Delete"; confirmedMerchant: string; confirmedAmountInWon: number }
  | {
      kind: "Split";
      items: readonly {
        merchant: string;
        amountInWon: number;
        categoryId: string;
        memo: string;
      }[];
    }
  | {
      kind: "RequestHouseholdNotification";
    };

export interface AuthenticatedQuickEditActor {
  principalRef: string;
  householdId: string;
  memberId: string;
}

export interface QuickEditCommandFixture {
  authSession:
    | { kind: "Authenticated"; actor: AuthenticatedQuickEditActor }
    | { kind: "Unauthenticated" };
  serverNow: string;
  currentUnsavedForm?: Pick<
    QuickEditTransactionView,
    "merchant" | "amountInWon" | "categoryId" | "memo"
  >;
}

export type QuickEditCommandResult =
  | { kind: "Succeeded"; operation: QuickEditOperation["kind"] }
  | {
      kind: "ValidationFailed";
      code:
        | "INVALID_AMOUNT"
        | "DELETE_CONFIRMATION_MISMATCH"
        | "INVALID_SPLIT"
        | "REQUESTER_REQUIRED";
    }
  | { kind: "Failed"; code: "SERVER_UNAVAILABLE" }
  | { kind: "Conflict"; code: "VERSION_MISMATCH" };

export interface QuickEditCommandState {
  transaction?: QuickEditTransactionView;
  derivedTransactions: readonly QuickEditTransactionView[];
  screen: "Open" | "Closed";
  successToasts: readonly string[];
  completionEvents: readonly QuickEditOperation["kind"][];
  notificationReceipts: readonly {
    requesterMemberId: string;
    requestedAt: string;
  }[];
}

export interface QuickEditCommandOutcomeContractSubject {
  execute(input: {
    operation: QuickEditOperation;
    expectedVersion: number;
    idempotencyKey: string;
    serverOutcome:
      | "success"
      | "already-processed"
      | "failure"
      | "failure-after-first-derived-write"
      | "conflict";
  }): Promise<QuickEditCommandResult>;
  recreateActivity(): void;
  state(): QuickEditCommandState;
}

export function createSubject(
  transaction: QuickEditTransactionView,
  fixture: QuickEditCommandFixture,
): QuickEditCommandOutcomeContractSubject {
  return createQuickEditCommandOutcomeFixture(transaction, fixture);
}

const transaction = (): QuickEditTransactionView => ({
  transactionId: "transaction-1",
  merchant: "원 가맹점",
  amountInWon: 10_000,
  categoryId: "food",
  memo: "기존 메모",
  aggregateVersion: 3,
});

const validUpdate: QuickEditOperation = {
  kind: "Update",
  form: {
    merchant: "수정 가맹점",
    amountInWon: 12_000,
    categoryId: "living",
    memo: "수정 메모",
  },
};

const authenticatedActor: AuthenticatedQuickEditActor = {
  principalRef: "principal:user-1",
  householdId: "household-1",
  memberId: "member-1",
};

const subjectFor = (
  original: QuickEditTransactionView,
  overrides: Partial<QuickEditCommandFixture> = {},
): QuickEditCommandOutcomeContractSubject =>
  createSubject(original, {
    authSession: { kind: "Authenticated", actor: authenticatedActor },
    serverNow: "2026-07-20T10:00:00+09:00",
    ...overrides,
  });

const operations: readonly QuickEditOperation[] = [
  validUpdate,
  {
    kind: "Delete",
    confirmedMerchant: "원 가맹점",
    confirmedAmountInWon: 10_000,
  },
  {
    kind: "Split",
    items: [
      { merchant: "분할 A", amountInWon: 4_000, categoryId: "food", memo: "" },
      { merchant: "분할 B", amountInWon: 6_000, categoryId: "living", memo: "" },
    ],
  },
  { kind: "RequestHouseholdNotification" },
];

describe("QuickEdit 서버 Command 결과 공개 계약", () => {
  it.each(operations)(
    "[T-QE-002][QE-002~006] $kind 실패를 성공 Toast·완료 event로 바꾸지 않고 화면과 원거래를 유지한다",
    async (operation) => {
      const original = transaction();
      const subject = subjectFor(original);

      expect(
        await subject.execute({
          operation,
          expectedVersion: original.aggregateVersion,
          idempotencyKey: `failure-${operation.kind}`,
          serverOutcome: "failure",
        }),
      ).toEqual({ kind: "Failed", code: "SERVER_UNAVAILABLE" });
      expect(subject.state()).toEqual({
        transaction: original,
        derivedTransactions: [],
        screen: "Open",
        successToasts: [],
        completionEvents: [],
        notificationReceipts: [],
      });
    },
  );

  it.each(operations)(
    "[T-QE-002][QE-002~006] $kind 성공은 서버의 정규 결과를 받은 뒤에만 화면을 닫고 완료 효과를 한 번 만든다",
    async (operation) => {
      const original = transaction();
      const subject = subjectFor(original);

      expect(
        await subject.execute({
          operation,
          expectedVersion: original.aggregateVersion,
          idempotencyKey: `success-${operation.kind}`,
          serverOutcome: "success",
        }),
      ).toEqual({ kind: "Succeeded", operation: operation.kind });
      expect(subject.state()).toMatchObject({
        screen: "Closed",
        successToasts: [expect.any(String)],
        completionEvents: [operation.kind],
      });
    },
  );

  it("[T-QE-002][QE-002] 빈 memo는 기존 memo를 지우는 명시적 값으로 성공 결과에 반영한다", async () => {
    const original = transaction();
    const subject = subjectFor(original);

    expect(
      await subject.execute({
        operation: {
          kind: "Update",
          form: {
            merchant: "수정 가맹점",
            amountInWon: 10_000,
            categoryId: "food",
            memo: "",
          },
        },
        expectedVersion: 3,
        idempotencyKey: "update-clear-memo",
        serverOutcome: "success",
      }),
    ).toEqual({ kind: "Succeeded", operation: "Update" });
    expect(subject.state()).toMatchObject({
      transaction: {
        transactionId: "transaction-1",
        merchant: "수정 가맹점",
        amountInWon: 10_000,
        categoryId: "food",
        memo: "",
        aggregateVersion: 4,
      },
      successToasts: [expect.any(String)],
      completionEvents: ["Update"],
    });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "[T-QE-002][QE-002] 양의 원 단위 정수가 아닌 금액 %s은 서버 결과와 무관하게 거부한다",
    async (amountInWon) => {
      const original = transaction();
      const subject = subjectFor(original);

      expect(
        await subject.execute({
          operation: {
            kind: "Update",
            form: { ...validUpdate.form, amountInWon },
          },
          expectedVersion: 3,
          idempotencyKey: `invalid-amount-${String(amountInWon)}`,
          serverOutcome: "success",
        }),
      ).toEqual({ kind: "ValidationFailed", code: "INVALID_AMOUNT" });
      expect(subject.state().transaction).toEqual(original);
      expect(subject.state().completionEvents).toEqual([]);
    },
  );

  it("[T-QE-002][QE-002] 안전하게 표현할 수 없는 원 단위 정수 금액은 정밀도 손실 전에 거부한다", async () => {
    const original = transaction();
    const subject = subjectFor(original);

    expect(
      await subject.execute({
        operation: {
          kind: "Update",
          form: {
            ...validUpdate.form,
            amountInWon: Number.MAX_SAFE_INTEGER + 1,
          },
        },
        expectedVersion: original.aggregateVersion,
        idempotencyKey: "unsafe-update-amount",
        serverOutcome: "success",
      }),
    ).toEqual({ kind: "ValidationFailed", code: "INVALID_AMOUNT" });
    expect(subject.state().transaction).toEqual(original);
    expect(subject.state().completionEvents).toEqual([]);
  });

  it("[T-QE-002][QE-004] 삭제 확인의 가맹점·금액이 원 snapshot과 다르면 삭제하지 않는다", async () => {
    const original = transaction();
    const subject = subjectFor(original);

    expect(
      await subject.execute({
        operation: {
          kind: "Delete",
          confirmedMerchant: "다른 가맹점",
          confirmedAmountInWon: 10_000,
        },
        expectedVersion: 3,
        idempotencyKey: "delete-mismatch",
        serverOutcome: "success",
      }),
    ).toEqual({
      kind: "ValidationFailed",
      code: "DELETE_CONFIRMATION_MISMATCH",
    });
    expect(subject.state().transaction).toEqual(original);
    expect(subject.state().screen).toBe("Open");
  });

  it("[T-QE-002][QE-004] 가맹점이 같아도 삭제 확인 금액이 원 snapshot과 다르면 삭제하지 않는다", async () => {
    const original = transaction();
    const subject = subjectFor(original);

    expect(
      await subject.execute({
        operation: {
          kind: "Delete",
          confirmedMerchant: original.merchant,
          confirmedAmountInWon: original.amountInWon + 1,
        },
        expectedVersion: original.aggregateVersion,
        idempotencyKey: "delete-amount-mismatch",
        serverOutcome: "success",
      }),
    ).toEqual({
      kind: "ValidationFailed",
      code: "DELETE_CONFIRMATION_MISMATCH",
    });
    expect(subject.state()).toMatchObject({
      transaction: original,
      screen: "Open",
      completionEvents: [],
    });
  });

  it("[T-QE-002][QE-004] 원 snapshot을 확인한 삭제는 서버 성공 뒤에만 화면을 닫고 완료를 알린다", async () => {
    const original = transaction();
    const subject = subjectFor(original);

    expect(
      await subject.execute({
        operation: {
          kind: "Delete",
          confirmedMerchant: original.merchant,
          confirmedAmountInWon: original.amountInWon,
        },
        expectedVersion: original.aggregateVersion,
        idempotencyKey: "delete-success",
        serverOutcome: "success",
      }),
    ).toEqual({ kind: "Succeeded", operation: "Delete" });
    expect(subject.state()).toMatchObject({
      transaction: undefined,
      derivedTransactions: [],
      screen: "Closed",
      successToasts: [expect.any(String)],
      completionEvents: ["Delete"],
    });
  });

  it("[T-QE-002][QE-005/QE-006] 유효하지 않은 분할은 원본을 유지하고 파생 거래를 만들지 않는다", async () => {
    const original = transaction();
    const subject = subjectFor(original);

    expect(
      await subject.execute({
        operation: {
          kind: "Split",
          items: [
            { merchant: "A", amountInWon: 4_000, categoryId: "food", memo: "" },
            { merchant: "B", amountInWon: 5_999, categoryId: "food", memo: "" },
          ],
        },
        expectedVersion: 3,
        idempotencyKey: "split-invalid-total",
        serverOutcome: "success",
      }),
    ).toEqual({ kind: "ValidationFailed", code: "INVALID_SPLIT" });
    expect(subject.state().transaction).toEqual(original);
    expect(subject.state().derivedTransactions).toEqual([]);
  });

  it.each([
    {
      label: "한 항목",
      items: [
        { merchant: "A", amountInWon: 10_000, categoryId: "food", memo: "" },
      ],
    },
    {
      label: "0원 항목",
      items: [
        { merchant: "A", amountInWon: 0, categoryId: "food", memo: "" },
        { merchant: "B", amountInWon: 10_000, categoryId: "food", memo: "" },
      ],
    },
    {
      label: "원 단위 정수가 아닌 항목",
      items: [
        { merchant: "A", amountInWon: 0.5, categoryId: "food", memo: "" },
        { merchant: "B", amountInWon: 9_999.5, categoryId: "food", memo: "" },
      ],
    },
  ])(
    "[T-QE-002][QE-005/QE-006] 합계만 일치해도 $label 분할은 원자 Command로 제출하지 않는다",
    async ({ items }) => {
      const original = transaction();
      const subject = subjectFor(original);

      expect(
        await subject.execute({
          operation: { kind: "Split", items },
          expectedVersion: original.aggregateVersion,
          idempotencyKey: `invalid-split-${items.length}-${items[0]?.amountInWon}`,
          serverOutcome: "success",
        }),
      ).toEqual({ kind: "ValidationFailed", code: "INVALID_SPLIT" });
      expect(subject.state()).toMatchObject({
        transaction: original,
        derivedTransactions: [],
        screen: "Open",
        completionEvents: [],
      });
    },
  );

  it("[T-QE-002][QE-003] requester가 없으면 알림 요청 성공으로 표시하거나 receipt를 만들지 않는다", async () => {
    const original = transaction();
    const subject = subjectFor(original, {
      authSession: { kind: "Unauthenticated" },
    });

    expect(
      await subject.execute({
        operation: { kind: "RequestHouseholdNotification" },
        expectedVersion: 3,
        idempotencyKey: "notify-without-authenticated-actor",
        serverOutcome: "success",
      }),
    ).toEqual({ kind: "ValidationFailed", code: "REQUESTER_REQUIRED" });
    expect(subject.state()).toMatchObject({
      transaction: original,
      successToasts: [],
      completionEvents: [],
      notificationReceipts: [],
    });
  });

  it("[T-QE-002][QE-003] 인증 상태 표지만 있고 안정적인 member ID가 비어 있으면 requester 부재로 거부한다", async () => {
    const original = transaction();
    const subject = subjectFor(original, {
      authSession: {
        kind: "Authenticated",
        actor: { ...authenticatedActor, memberId: "   " },
      },
    });

    expect(
      await subject.execute({
        operation: { kind: "RequestHouseholdNotification" },
        expectedVersion: original.aggregateVersion,
        idempotencyKey: "notify-with-blank-member-id",
        serverOutcome: "success",
      }),
    ).toEqual({ kind: "ValidationFailed", code: "REQUESTER_REQUIRED" });
    expect(subject.state().notificationReceipts).toEqual([]);
    expect(subject.state().completionEvents).toEqual([]);
  });

  it("[T-QE-002][QE-003] 명시적 알림 요청은 인증 Actor와 서버 시각만 기록하고 client가 보낸 requester·시각·미저장 form은 신뢰하지 않는다", async () => {
    const original = transaction();
    const currentUnsavedForm = {
      merchant: "아직 저장하지 않은 가맹점",
      amountInWon: 99_000,
      categoryId: "unsaved-category",
      memo: "아직 저장하지 않은 메모",
    };
    const subject = subjectFor(original, { currentUnsavedForm });
    const spoofedClientOperation = {
      kind: "RequestHouseholdNotification",
      requesterMemberId: "member-attacker",
      requestedAt: "1999-01-01T00:00:00+09:00",
      currentUnsavedForm,
    } as unknown as QuickEditOperation;

    expect(
      await subject.execute({
        operation: spoofedClientOperation,
        expectedVersion: 3,
        idempotencyKey: "notify-authenticated-actor",
        serverOutcome: "success",
      }),
    ).toEqual({
      kind: "Succeeded",
      operation: "RequestHouseholdNotification",
    });
    expect(subject.state()).toMatchObject({
      transaction: original,
      notificationReceipts: [
        {
          requesterMemberId: "member-1",
          requestedAt: "2026-07-20T10:00:00+09:00",
        },
      ],
      completionEvents: ["RequestHouseholdNotification"],
    });
    expect(subject.state().transaction).not.toMatchObject(currentUnsavedForm);
  });

  it("[T-QE-002][QE-006] 서버가 첫 파생 write 뒤 실패해도 원본과 일부 파생 결과를 노출하지 않는다", async () => {
    const original = transaction();
    const subject = subjectFor(original);

    expect(
      await subject.execute({
        operation: {
          kind: "Split",
          items: [
            { merchant: "분할 A", amountInWon: 4_000, categoryId: "food", memo: "" },
            { merchant: "분할 B", amountInWon: 6_000, categoryId: "living", memo: "" },
          ],
        },
        expectedVersion: 3,
        idempotencyKey: "split-partial-failure",
        serverOutcome: "failure-after-first-derived-write",
      }),
    ).toEqual({ kind: "Failed", code: "SERVER_UNAVAILABLE" });
    expect(subject.state()).toEqual({
      transaction: original,
      derivedTransactions: [],
      screen: "Open",
      successToasts: [],
      completionEvents: [],
      notificationReceipts: [],
    });
  });

  it("[T-QE-002][QE-002~006] Activity 재생성 뒤 같은 idempotency key의 AlreadyProcessed 응답은 완료 효과를 중복하지 않는다", async () => {
    const original = transaction();
    const subject = subjectFor(original);
    const input = {
      operation: validUpdate,
      expectedVersion: 3,
      idempotencyKey: "update-stable-across-recreation",
    } as const;

    expect(await subject.execute({ ...input, serverOutcome: "success" })).toEqual({
      kind: "Succeeded",
      operation: "Update",
    });
    subject.recreateActivity();
    expect(
      await subject.execute({ ...input, serverOutcome: "already-processed" }),
    ).toEqual({ kind: "Succeeded", operation: "Update" });
    expect(subject.state()).toMatchObject({
      transaction: { aggregateVersion: 4 },
      completionEvents: ["Update"],
      successToasts: [expect.any(String)],
    });
  });

  it("[T-QE-002][QE-002~006] 일시 실패한 멱등 Command는 같은 key로 재시도해 성공해도 완료 효과가 한 번만 생긴다", async () => {
    const original = transaction();
    const subject = subjectFor(original);
    const input = {
      operation: validUpdate,
      expectedVersion: original.aggregateVersion,
      idempotencyKey: "update-after-retryable-failure",
    } as const;

    expect(await subject.execute({ ...input, serverOutcome: "failure" })).toEqual({
      kind: "Failed",
      code: "SERVER_UNAVAILABLE",
    });
    expect(await subject.execute({ ...input, serverOutcome: "success" })).toEqual({
      kind: "Succeeded",
      operation: "Update",
    });
    expect(subject.state()).toMatchObject({
      transaction: { aggregateVersion: 4 },
      completionEvents: ["Update"],
      successToasts: [expect.any(String)],
    });
  });

  it("[T-QE-002][QE-002~006] 같은 idempotency key를 다른 payload로 재전달해도 서버의 최초 정규 결과만 반영한다", async () => {
    const original = transaction();
    const subject = subjectFor(original);
    const idempotencyKey = "update-canonical-replay";

    expect(
      await subject.execute({
        operation: validUpdate,
        expectedVersion: original.aggregateVersion,
        idempotencyKey,
        serverOutcome: "success",
      }),
    ).toEqual({ kind: "Succeeded", operation: "Update" });

    const firstState = subject.state();
    expect(
      await subject.execute({
        operation: {
          kind: "Update",
          form: {
            merchant: "재전달 payload",
            amountInWon: 99_999,
            categoryId: "spoofed",
            memo: "재전달 메모",
          },
        },
        expectedVersion: original.aggregateVersion,
        idempotencyKey,
        serverOutcome: "already-processed",
      }),
    ).toEqual({ kind: "Succeeded", operation: "Update" });
    expect(subject.state()).toEqual(firstState);
  });

  it("[T-QE-002][QE-006] 분할 성공 응답을 잃어 같은 idempotency key로 재조회해도 같은 파생 집합만 반환한다", async () => {
    const original = transaction();
    const subject = subjectFor(original);
    const splitOperation: QuickEditOperation = {
      kind: "Split",
      items: [
        { merchant: "분할 A", amountInWon: 4_000, categoryId: "food", memo: "" },
        { merchant: "분할 B", amountInWon: 6_000, categoryId: "living", memo: "" },
      ],
    };
    const input = {
      operation: splitOperation,
      expectedVersion: 3,
      idempotencyKey: "split-replay-stable",
    } as const;

    expect(await subject.execute({ ...input, serverOutcome: "success" })).toEqual({
      kind: "Succeeded",
      operation: "Split",
    });
    const firstDerived = subject.state().derivedTransactions;
    expect(firstDerived).toHaveLength(2);

    subject.recreateActivity();
    expect(
      await subject.execute({ ...input, serverOutcome: "already-processed" }),
    ).toEqual({ kind: "Succeeded", operation: "Split" });
    expect(subject.state()).toMatchObject({
      derivedTransactions: firstDerived,
      completionEvents: ["Split"],
      successToasts: [expect.any(String)],
    });
  });

  it("[T-QE-002][QE-002~006] version 충돌도 로컬 값을 덮어쓰거나 화면을 닫지 않는다", async () => {
    const original = transaction();
    const subject = subjectFor(original);

    expect(
      await subject.execute({
        operation: validUpdate,
        expectedVersion: 3,
        idempotencyKey: "update-conflict",
        serverOutcome: "conflict",
      }),
    ).toEqual({ kind: "Conflict", code: "VERSION_MISMATCH" });
    expect(subject.state()).toEqual({
      transaction: original,
      derivedTransactions: [],
      screen: "Open",
      successToasts: [],
      completionEvents: [],
      notificationReceipts: [],
    });
  });
});

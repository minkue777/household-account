import { describe, expect, it } from "vitest";
import { createReportingAuthoritativeActionFixtureSubject } from "../../../support/reporting-authoritative-action-fixture";

interface ReportingTransactionView {
  transactionId: string;
  merchant: string;
  amountInWon: number;
  lifecycle: "active" | "deleted";
  aggregateVersion: number;
}

interface ReportingMerchantRuleView {
  ruleId: string;
  merchantPattern: string;
  categoryId: string;
  aggregateVersion: number;
}

type ReportingOwnedAction =
  | {
      kind: "update-transaction";
      commandId: string;
      transactionId: string;
      expectedVersion: number;
      merchant: string;
      amountInWon: number;
    }
  | {
      kind: "delete-transaction";
      commandId: string;
      transactionId: string;
      expectedVersion: number;
    }
  | {
      kind: "save-merchant-rule";
      commandId: string;
      merchantPattern: string;
      categoryId: string;
    };

interface ReportingUpstreamReceipt {
  receiptId: string;
  commandId: string;
  ownerModule: "ledger" | "payment-configuration";
  aggregateId: string;
  resultingVersion: number;
}

interface ReportingUpstreamEvent {
  eventType:
    | "TransactionChanged.v1"
    | "TransactionDeleted.v1"
    | "MerchantRuleChanged.v1";
  aggregateId: string;
  aggregateVersion: number;
}

interface ReportingAuthoritativeState {
  transactions: readonly ReportingTransactionView[];
  merchantRules: readonly ReportingMerchantRuleView[];
  queryRevision: number;
}

type ReportingOwnedActionResult =
  | {
      kind: "success";
      state: ReportingAuthoritativeState;
      receipt: ReportingUpstreamReceipt;
      event: ReportingUpstreamEvent;
    }
  | {
      kind: "conflict" | "failure";
      code: string;
      state: ReportingAuthoritativeState;
    };

interface ReportingActionAuthoritativeFixture {
  initialState: ReportingAuthoritativeState;
  forcedOutcome?: "conflict" | "failure";
}

/** Reporting이 소유 모듈 Command 결과 뒤 권위 상태로 수렴하는 공개 계약입니다. */
export interface ReportingActionAuthoritativeStateSubject {
  execute(action: ReportingOwnedAction): Promise<ReportingOwnedActionResult>;
  currentState(): ReportingAuthoritativeState;
  upstreamReceipts(): readonly ReportingUpstreamReceipt[];
  upstreamEvents(): readonly ReportingUpstreamEvent[];
}

export function createSubject(
  fixture: ReportingActionAuthoritativeFixture,
): ReportingActionAuthoritativeStateSubject {
  return createReportingAuthoritativeActionFixtureSubject(fixture);
}

const transaction: ReportingTransactionView = {
  transactionId: "expense-1",
  merchant: "이전 가맹점",
  amountInWon: 10_000,
  lifecycle: "active",
  aggregateVersion: 3,
};

const initial: ReportingAuthoritativeState = {
  transactions: [transaction],
  merchantRules: [],
  queryRevision: 10,
};

describe("Reporting Action 권위 상태·receipt 계약", () => {
  it("[T-STAT-005][STAT-004] 거래 수정 성공은 Ledger 최종 상태·receipt·Event를 반영한 새 Query revision으로 수렴한다", async () => {
    const subject = createSubject({ initialState: initial });

    const result = await subject.execute({
      kind: "update-transaction",
      commandId: "update-expense-1",
      transactionId: "expense-1",
      expectedVersion: 3,
      merchant: "변경 가맹점",
      amountInWon: 20_000,
    });

    expect(result).toEqual({
      kind: "success",
      state: {
        transactions: [
          {
            ...transaction,
            merchant: "변경 가맹점",
            amountInWon: 20_000,
            aggregateVersion: 4,
          },
        ],
        merchantRules: [],
        queryRevision: expect.any(Number),
      },
      receipt: expect.objectContaining({
        commandId: "update-expense-1",
        ownerModule: "ledger",
        aggregateId: "expense-1",
        resultingVersion: 4,
      }),
      event: {
        eventType: "TransactionChanged.v1",
        aggregateId: "expense-1",
        aggregateVersion: 4,
      },
    });
    if (result.kind !== "success") return;
    expect(result.state.queryRevision).toBeGreaterThan(initial.queryRevision);
    expect(subject.currentState()).toEqual(result.state);
    expect(subject.upstreamReceipts()).toEqual([result.receipt]);
    expect(subject.upstreamEvents()).toEqual([result.event]);
  });

  it("[T-STAT-005][STAT-004] 거래 삭제 성공은 권위 조회에서 deleted 거래를 제외하되 receipt·Event로 완료를 식별한다", async () => {
    const subject = createSubject({ initialState: initial });

    const result = await subject.execute({
      kind: "delete-transaction",
      commandId: "delete-expense-1",
      transactionId: "expense-1",
      expectedVersion: 3,
    });

    expect(result).toMatchObject({
      kind: "success",
      state: { transactions: [] },
      receipt: {
        commandId: "delete-expense-1",
        ownerModule: "ledger",
        aggregateId: "expense-1",
        resultingVersion: 4,
      },
      event: {
        eventType: "TransactionDeleted.v1",
        aggregateId: "expense-1",
        aggregateVersion: 4,
      },
    });
    expect(subject.currentState().transactions).toEqual([]);
    expect(subject.upstreamReceipts()).toHaveLength(1);
    expect(subject.upstreamEvents()).toHaveLength(1);
  });

  it("[T-STAT-005][STAT-004] 가맹점 규칙 저장 성공은 Payment Configuration의 권위 규칙 상태를 확인한 뒤 화면 revision을 전진시킨다", async () => {
    const subject = createSubject({ initialState: initial });

    const result = await subject.execute({
      kind: "save-merchant-rule",
      commandId: "save-rule-1",
      merchantPattern: "카페",
      categoryId: "food",
    });

    expect(result).toMatchObject({
      kind: "success",
      state: {
        transactions: [transaction],
        merchantRules: [
          {
            ruleId: expect.any(String),
            merchantPattern: "카페",
            categoryId: "food",
            aggregateVersion: 1,
          },
        ],
      },
      receipt: {
        commandId: "save-rule-1",
        ownerModule: "payment-configuration",
        aggregateId: expect.any(String),
        resultingVersion: 1,
      },
      event: {
        eventType: "MerchantRuleChanged.v1",
        aggregateId: expect.any(String),
        aggregateVersion: 1,
      },
    });
    if (result.kind !== "success") return;
    expect(result.state.queryRevision).toBeGreaterThan(initial.queryRevision);
    expect(subject.currentState()).toEqual(result.state);
    expect(subject.upstreamReceipts()).toEqual([result.receipt]);
    expect(subject.upstreamEvents()).toEqual([result.event]);
  });

  it.each(["conflict", "failure"] as const)(
    "[T-STAT-005][STAT-004] upstream %s는 권위 상태·revision·receipt·Event를 바꾸지 않는다",
    async (forcedOutcome) => {
      const subject = createSubject({ initialState: initial, forcedOutcome });

      const result = await subject.execute({
        kind: "update-transaction",
        commandId: `update-${forcedOutcome}`,
        transactionId: "expense-1",
        expectedVersion: 3,
        merchant: "변경 가맹점",
        amountInWon: 20_000,
      });

      expect(result).toEqual({
        kind: forcedOutcome,
        code:
          forcedOutcome === "conflict"
            ? "TRANSACTION_VERSION_MISMATCH"
            : "LEDGER_UNAVAILABLE",
        state: initial,
      });
      expect(subject.currentState()).toEqual(initial);
      expect(subject.upstreamReceipts()).toEqual([]);
      expect(subject.upstreamEvents()).toEqual([]);
    },
  );
});

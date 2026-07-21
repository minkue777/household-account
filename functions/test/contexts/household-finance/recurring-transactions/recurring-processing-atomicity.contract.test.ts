import { describe, expect, it } from "vitest";
import { createRecurringProcessingAtomicityFixture } from "../../../support/recurring-processing-fixture";

type RecurringCommitFailure =
  | "transaction-save"
  | "execution-checkpoint-save"
  | "receipt-save";

export type ProcessRecurringMonthResult =
  | {
      kind: "success";
      planId: string;
      targetMonth: string;
      ledgerTransactionId: string;
      executionVersion: number;
    }
  | {
      kind: "already-processed";
      ledgerTransactionId: string;
    }
  | {
      kind: "retryable-failure";
      code:
        | "LEDGER_TRANSACTION_SAVE_FAILED"
        | "RECURRING_CHECKPOINT_SAVE_FAILED"
        | "PROCESS_RECEIPT_SAVE_FAILED";
    };

export interface RecurringAtomicitySnapshot {
  plans: readonly {
    planId: string;
    creatorMemberId: string;
    version: number;
  }[];
  executions: readonly {
    executionKey: string;
    status: "completed";
    ledgerTransactionId: string;
    version: number;
  }[];
  ledgerTransactions: readonly {
    transactionId: string;
    source: "recurring";
    recurringPlanId: string;
    recurringTargetMonth: string;
    creatorMemberId: string;
  }[];
  processReceipts: readonly {
    idempotencyKey: string;
    ledgerTransactionId: string;
  }[];
}

export interface RecurringProcessingEvent {
  eventType: "TransactionRecorded.v1" | "RecurringPlanProcessed.v1";
  eventId: string;
  planId: string;
  targetMonth: string;
  transactionId: string;
}

/**
 * Recurring와 Ledger participant를 묶는 Household Finance Workflow 경계입니다.
 * 내부 commit 순서나 호출 횟수가 아니라 네 Canonical 결과의 원자성을 검증합니다.
 */
export interface RecurringProcessingAtomicitySubject {
  processRecurringMonth(input: {
    planId: string;
    targetMonth: string;
    idempotencyKey: string;
  }): Promise<ProcessRecurringMonthResult>;
  setCommitFailureForTest(failure?: RecurringCommitFailure): void;
  snapshot(): Promise<RecurringAtomicitySnapshot>;
  publishedEvents(): Promise<readonly RecurringProcessingEvent[]>;
}

export function createSubject(): RecurringProcessingAtomicitySubject {
  return createRecurringProcessingAtomicityFixture();
}

const processInput = {
  planId: "recurring-plan-1",
  targetMonth: "2026-07",
  idempotencyKey: "recurring-plan-1:2026-07",
} as const;

describe("정기 거래 처리의 Finance Unit of Work 원자성 계약", () => {
  it("[T-REC-006][REC-002] Ledger 거래 저장 실패는 execution·checkpoint·receipt·Event까지 이전 상태로 되돌린다", async () => {
    const subject = createSubject();
    const before = await subject.snapshot();
    subject.setCommitFailureForTest("transaction-save");

    const result = await subject.processRecurringMonth(processInput);

    expect(result).toEqual({
      kind: "retryable-failure",
      code: "LEDGER_TRANSACTION_SAVE_FAILED",
    });
    expect(await subject.snapshot()).toEqual(before);
    expect(await subject.publishedEvents()).toEqual([]);
  });

  it("[T-REC-006][REC-002] execution checkpoint 저장 실패는 이미 성공한 것처럼 거래만 남기지 않는다", async () => {
    const subject = createSubject();
    const before = await subject.snapshot();
    subject.setCommitFailureForTest("execution-checkpoint-save");

    const result = await subject.processRecurringMonth(processInput);

    expect(result).toEqual({
      kind: "retryable-failure",
      code: "RECURRING_CHECKPOINT_SAVE_FAILED",
    });
    expect(await subject.snapshot()).toEqual(before);
    expect(await subject.publishedEvents()).toEqual([]);
  });

  it("[T-REC-006][REC-002] process receipt 저장 실패도 거래·execution과 두 공개 Event를 남기지 않는다", async () => {
    const subject = createSubject();
    const before = await subject.snapshot();
    subject.setCommitFailureForTest("receipt-save");

    const result = await subject.processRecurringMonth(processInput);

    expect(result).toEqual({
      kind: "retryable-failure",
      code: "PROCESS_RECEIPT_SAVE_FAILED",
    });
    expect(await subject.snapshot()).toEqual(before);
    expect(await subject.publishedEvents()).toEqual([]);
  });

  it("[T-REC-006][REC-002] 실패가 해소된 같은 key 재실행은 거래·execution·receipt와 Event를 정확히 한 세트로 확정한다", async () => {
    const subject = createSubject();
    subject.setCommitFailureForTest("transaction-save");
    await subject.processRecurringMonth(processInput);
    subject.setCommitFailureForTest(undefined);

    const result = await subject.processRecurringMonth(processInput);

    expect(result).toEqual({
      kind: "success",
      planId: "recurring-plan-1",
      targetMonth: "2026-07",
      ledgerTransactionId: expect.any(String),
      executionVersion: 1,
    });
    if (result.kind !== "success") {
      throw new Error("정기 거래 재처리가 성공하지 않았습니다.");
    }
    const state = await subject.snapshot();
    expect(state.executions).toEqual([
      {
        executionKey: "recurring-plan-1:2026-07",
        status: "completed",
        ledgerTransactionId: result.ledgerTransactionId,
        version: 1,
      },
    ]);
    expect(state.ledgerTransactions).toEqual([
      {
        transactionId: result.ledgerTransactionId,
        source: "recurring",
        recurringPlanId: "recurring-plan-1",
        recurringTargetMonth: "2026-07",
        creatorMemberId: "member-plan-creator",
      },
    ]);
    expect(state.processReceipts).toEqual([
      {
        idempotencyKey: "recurring-plan-1:2026-07",
        ledgerTransactionId: result.ledgerTransactionId,
      },
    ]);
    expect(await subject.publishedEvents()).toEqual([
      expect.objectContaining({
        eventType: "TransactionRecorded.v1",
        planId: "recurring-plan-1",
        targetMonth: "2026-07",
        transactionId: result.ledgerTransactionId,
      }),
      expect.objectContaining({
        eventType: "RecurringPlanProcessed.v1",
        planId: "recurring-plan-1",
        targetMonth: "2026-07",
        transactionId: result.ledgerTransactionId,
      }),
    ]);
  });

  it("[T-REC-006][REC-002] 성공 뒤 같은 key 재전달은 최초 transactionId를 재생하고 최종 상태·Event를 늘리지 않는다", async () => {
    const subject = createSubject();
    const first = await subject.processRecurringMonth(processInput);
    const beforeReplay = await subject.snapshot();
    const eventsBeforeReplay = await subject.publishedEvents();

    const replay = await subject.processRecurringMonth(processInput);

    expect(first.kind).toBe("success");
    if (first.kind !== "success") {
      throw new Error("테스트 준비용 정기 거래 처리에 실패했습니다.");
    }
    expect(replay).toEqual({
      kind: "already-processed",
      ledgerTransactionId: first.ledgerTransactionId,
    });
    expect(await subject.snapshot()).toEqual(beforeReplay);
    expect(await subject.publishedEvents()).toEqual(eventsBeforeReplay);
  });
});

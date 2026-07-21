import { describe, expect, it } from "vitest";
import { createRecurringSchedulerWorkflowFixture } from "../../../support/recurring-processing-fixture";

interface RecurringPlanSeed {
  householdId: string;
  planId: string;
  merchant: string;
  amountInWon: number;
  categoryId: string;
  dayOfMonth: number;
  memo: string;
  active: boolean;
  creatorMemberId: string;
  firstApplicableMonth: string;
  version: number;
}

interface RecurringExecutionView {
  executionKey: string;
  planId: string;
  targetMonth: string;
  effectiveDate: string;
  status: "completed";
  ledgerTransactionId: string;
  processedAt: string;
  version: number;
}

interface RecurringLedgerTransactionView {
  transactionId: string;
  planId: string;
  targetMonth: string;
  transactionType: "expense";
  source: "recurring";
  originChannel: "recurring";
  creatorMemberId: string;
  merchant: string;
  amountInWon: number;
  categoryId: string;
  memo: string;
  accountingDate: string;
}

type ProcessRecurringTargetResult =
  | {
      kind: "created";
      planId: string;
      targetMonth: string;
      effectiveDate: string;
      ledgerTransactionId: string;
    }
  | {
      kind: "already-processed";
      planId: string;
      targetMonth: string;
      ledgerTransactionId: string;
    }
  | {
      kind: "no-data";
      planId: string;
      targetMonth?: string;
      reason: "INACTIVE_PLAN" | "NOT_DUE" | "NON_POSITIVE_PLAN_AMOUNT";
    }
  | {
      kind: "retryable-failure";
      planId: string;
      targetMonth: string;
      code: string;
    };

type ProcessDueRecurringPlansResult =
  | {
      kind: "success";
      results: readonly ProcessRecurringTargetResult[];
      nextCheckpoint?: string;
      completed: boolean;
    }
  | {
      kind: "partial-failure";
      results: readonly ProcessRecurringTargetResult[];
      retryFromCheckpoint: string;
      completed: false;
    }
  | { kind: "validation-error"; code: string }
  | { kind: "retryable-failure"; code: string; checkpoint?: string };

interface RecurringSchedulerSnapshot {
  executions: readonly RecurringExecutionView[];
  ledgerTransactions: readonly RecurringLedgerTransactionView[];
  receipts: readonly {
    idempotencyKey: string;
    ledgerTransactionId: string;
  }[];
  outboxEvents: readonly {
    eventType: "TransactionRecorded.v1" | "RecurringPlanProcessed.v1";
    planId: string;
    targetMonth: string;
    transactionId: string;
  }[];
}

interface RecurringProcessActor {
  kind: "system";
  capabilities: readonly "recurring.process"[];
}

export interface RecurringSchedulerWorkflowSubject {
  processMonth(input: {
    actor: RecurringProcessActor;
    householdId: string;
    planId: string;
    targetMonth: string;
  }): Promise<ProcessRecurringTargetResult>;
  processDue(input: {
    actor: RecurringProcessActor;
    asOfDate: string;
    householdZoneId: "Asia/Seoul";
    checkpoint?: string;
    limit: number;
  }): Promise<ProcessDueRecurringPlansResult>;
  clearTargetFailureForTest(targetKey: string): void;
  snapshot(): Promise<RecurringSchedulerSnapshot>;
}

export function createSubject(_fixture: {
  now: string;
  plans: readonly RecurringPlanSeed[];
  completedExecutions?: readonly RecurringExecutionView[];
  failTargetKeys?: readonly string[];
}): RecurringSchedulerWorkflowSubject {
  return createRecurringSchedulerWorkflowFixture(_fixture);
}

const schedulerActor: RecurringProcessActor = {
  kind: "system",
  capabilities: ["recurring.process"],
};

function plan(
  planId: string,
  overrides: Partial<RecurringPlanSeed> = {},
): RecurringPlanSeed {
  return {
    householdId: "house-1",
    planId,
    merchant: `정기-${planId}`,
    amountInWon: 10_000,
    categoryId: "fixed",
    dayOfMonth: 18,
    memo: "정기 메모",
    active: true,
    creatorMemberId: "member-plan-creator",
    firstApplicableMonth: "2026-07",
    version: 1,
    ...overrides,
  };
}

describe("정기 거래 Scheduler·Ledger 종단 공개 계약", () => {
  it("[T-REC-002][REC-002] 31일 Plan의 2월 처리는 말일 회계일의 실제 Ledger 거래와 execution을 만든다", async () => {
    const subject = createSubject({
      now: "2026-02-28T00:00:00+09:00",
      plans: [
        plan("month-end", {
          dayOfMonth: 31,
          firstApplicableMonth: "2026-01",
        }),
      ],
    });

    const result = await subject.processMonth({
      actor: schedulerActor,
      householdId: "house-1",
      planId: "month-end",
      targetMonth: "2026-02",
    });

    expect(result).toEqual({
      kind: "created",
      planId: "month-end",
      targetMonth: "2026-02",
      effectiveDate: "2026-02-28",
      ledgerTransactionId: expect.any(String),
    });
    if (result.kind !== "created") return;
    expect(await subject.snapshot()).toMatchObject({
      executions: [
        {
          executionKey: "month-end:2026-02",
          planId: "month-end",
          targetMonth: "2026-02",
          effectiveDate: "2026-02-28",
          status: "completed",
          ledgerTransactionId: result.ledgerTransactionId,
          version: 1,
        },
      ],
      ledgerTransactions: [
        {
          transactionId: result.ledgerTransactionId,
          planId: "month-end",
          targetMonth: "2026-02",
          transactionType: "expense",
          source: "recurring",
          originChannel: "recurring",
          creatorMemberId: "member-plan-creator",
          merchant: "정기-month-end",
          amountInWon: 10_000,
          categoryId: "fixed",
          memo: "정기 메모",
          accountingDate: "2026-02-28",
        },
      ],
    });
  });

  it("[T-REC-001][REC-002] 같은 plan·month 동시 실행은 거래·execution·두 Event 한 세트에 수렴한다", async () => {
    const subject = createSubject({
      now: "2026-07-18T00:00:00+09:00",
      plans: [plan("concurrent")],
    });
    const command = {
      actor: schedulerActor,
      householdId: "house-1",
      planId: "concurrent",
      targetMonth: "2026-07",
    } as const;

    const results = await Promise.all([
      subject.processMonth(command),
      subject.processMonth(command),
    ]);

    expect(results.filter(({ kind }) => kind === "created")).toHaveLength(1);
    expect(
      results.filter(({ kind }) => kind === "already-processed"),
    ).toHaveLength(1);
    const state = await subject.snapshot();
    expect(state.executions).toHaveLength(1);
    expect(state.ledgerTransactions).toHaveLength(1);
    expect(state.receipts).toHaveLength(1);
    expect(state.outboxEvents).toEqual([
      expect.objectContaining({
        eventType: "TransactionRecorded.v1",
        planId: "concurrent",
        targetMonth: "2026-07",
      }),
      expect.objectContaining({
        eventType: "RecurringPlanProcessed.v1",
        planId: "concurrent",
        targetMonth: "2026-07",
      }),
    ]);
  });

  it("[T-REC-005][REC-002/REC-003] 00시 일일 입력은 7·8·9월 누락을 오래된 순서로 실제 생성하고 재실행해도 늘리지 않는다", async () => {
    const subject = createSubject({
      now: "2026-09-18T00:00:00+09:00",
      plans: [plan("backfill")],
    });
    const input = {
      actor: schedulerActor,
      asOfDate: "2026-09-18",
      householdZoneId: "Asia/Seoul" as const,
      limit: 20,
    };

    const first = await subject.processDue(input);
    const stateAfterFirst = await subject.snapshot();
    const replay = await subject.processDue(input);

    expect(first).toMatchObject({
      kind: "success",
      results: [
        { kind: "created", planId: "backfill", targetMonth: "2026-07" },
        { kind: "created", planId: "backfill", targetMonth: "2026-08" },
        { kind: "created", planId: "backfill", targetMonth: "2026-09" },
      ],
      completed: true,
    });
    expect(stateAfterFirst.ledgerTransactions).toEqual([
      expect.objectContaining({
        planId: "backfill",
        targetMonth: "2026-07",
        accountingDate: "2026-07-18",
      }),
      expect.objectContaining({
        planId: "backfill",
        targetMonth: "2026-08",
        accountingDate: "2026-08-18",
      }),
      expect.objectContaining({
        planId: "backfill",
        targetMonth: "2026-09",
        accountingDate: "2026-09-18",
      }),
    ]);
    expect(replay).toMatchObject({
      kind: "success",
      results: [
        { kind: "already-processed", targetMonth: "2026-07" },
        { kind: "already-processed", targetMonth: "2026-08" },
        { kind: "already-processed", targetMonth: "2026-09" },
      ],
      completed: true,
    });
    expect(await subject.snapshot()).toEqual(stateAfterFirst);
  });

  it("[T-REC-005][REC-002] 비활성 또는 양수가 아닌 legacy Plan은 Ledger 자동 생성 후보가 아니다", async () => {
    const subject = createSubject({
      now: "2026-09-18T00:00:00+09:00",
      plans: [
        plan("inactive", { active: false }),
        plan("zero-legacy", { amountInWon: 0 }),
      ],
    });

    const result = await subject.processDue({
      actor: schedulerActor,
      asOfDate: "2026-09-18",
      householdZoneId: "Asia/Seoul",
      limit: 20,
    });

    expect(result).toEqual({
      kind: "success",
      results: [
        {
          kind: "no-data",
          planId: "inactive",
          reason: "INACTIVE_PLAN",
        },
        {
          kind: "no-data",
          planId: "zero-legacy",
          reason: "NON_POSITIVE_PLAN_AMOUNT",
        },
      ],
      completed: true,
    });
    expect(await subject.snapshot()).toEqual({
      executions: [],
      ledgerTransactions: [],
      receipts: [],
      outboxEvents: [],
    });
  });

  it("[T-REC-005][REC-003] page limit checkpoint는 한 Plan의 남은 월을 버리지 않고 다음 호출에서 이어 처리한다", async () => {
    const subject = createSubject({
      now: "2026-09-18T00:00:00+09:00",
      plans: [plan("paged")],
    });

    const first = await subject.processDue({
      actor: schedulerActor,
      asOfDate: "2026-09-18",
      householdZoneId: "Asia/Seoul",
      limit: 2,
    });

    expect(first).toMatchObject({
      kind: "success",
      results: [
        { kind: "created", targetMonth: "2026-07" },
        { kind: "created", targetMonth: "2026-08" },
      ],
      nextCheckpoint: expect.any(String),
      completed: false,
    });
    if (first.kind !== "success" || !first.nextCheckpoint) return;

    const second = await subject.processDue({
      actor: schedulerActor,
      asOfDate: "2026-09-18",
      householdZoneId: "Asia/Seoul",
      checkpoint: first.nextCheckpoint,
      limit: 2,
    });

    expect(second).toEqual({
      kind: "success",
      results: [
        expect.objectContaining({ kind: "created", targetMonth: "2026-09" }),
      ],
      completed: true,
    });
    const state = await subject.snapshot();
    expect(state.executions.map(({ targetMonth }) => targetMonth)).toEqual([
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
    expect(new Set(state.ledgerTransactions.map(({ transactionId }) => transactionId)).size)
      .toBe(3);
  });

  it("[T-REC-005][T-REC-006][REC-002/REC-003] 부분 실패 checkpoint 재개는 성공 월을 다시 만들지 않고 실패 월부터 수렴한다", async () => {
    const targetKey = "recover:2026-08";
    const subject = createSubject({
      now: "2026-09-18T00:00:00+09:00",
      plans: [plan("recover")],
      failTargetKeys: [targetKey],
    });

    const first = await subject.processDue({
      actor: schedulerActor,
      asOfDate: "2026-09-18",
      householdZoneId: "Asia/Seoul",
      limit: 20,
    });

    expect(first).toMatchObject({
      kind: "partial-failure",
      results: [
        { kind: "created", targetMonth: "2026-07" },
        {
          kind: "retryable-failure",
          targetMonth: "2026-08",
          code: "RECURRING_TARGET_PROCESS_FAILED",
        },
      ],
      retryFromCheckpoint: expect.any(String),
      completed: false,
    });
    if (first.kind !== "partial-failure") return;
    const july = (await subject.snapshot()).ledgerTransactions[0];
    subject.clearTargetFailureForTest(targetKey);

    const resumed = await subject.processDue({
      actor: schedulerActor,
      asOfDate: "2026-09-18",
      householdZoneId: "Asia/Seoul",
      checkpoint: first.retryFromCheckpoint,
      limit: 20,
    });

    expect(resumed).toMatchObject({
      kind: "success",
      results: [
        { kind: "created", targetMonth: "2026-08" },
        { kind: "created", targetMonth: "2026-09" },
      ],
      completed: true,
    });
    const finalState = await subject.snapshot();
    expect(finalState.ledgerTransactions).toHaveLength(3);
    expect(finalState.ledgerTransactions[0]).toEqual(july);
    expect(
      finalState.ledgerTransactions.filter(
        ({ planId, targetMonth }) =>
          planId === "recover" && targetMonth === "2026-07",
      ),
    ).toHaveLength(1);
  });
});

import type {
  ProcessRecurringTargetResult,
  RecurringProcessingDecision,
  RecurringProcessingEvent,
  RecurringProcessingState,
} from "../model/recurringProcessing";
import { resolveRecurringEffectiveDate } from "./recurringSchedule";

function signature(input: {
  householdId: string;
  planId: string;
  targetMonth: string;
}): string {
  return JSON.stringify([input.householdId, input.planId, input.targetMonth]);
}

export function decideRecurringTarget(input: {
  readonly state: RecurringProcessingState;
  readonly householdId: string;
  readonly planId: string;
  readonly targetMonth: string;
  readonly idempotencyKey: string;
  readonly asOfDate: string;
  readonly processedAt: string;
  readonly ledgerTransactionId: string;
  readonly transactionEventId: string;
  readonly processedEventId: string;
}): RecurringProcessingDecision {
  const plan = input.state.plans.find(
    (candidate) =>
      candidate.householdId === input.householdId &&
      candidate.planId === input.planId,
  );
  if (plan === undefined) {
    return {
      kind: "return",
      result: {
        kind: "no-data",
        planId: input.planId,
        targetMonth: input.targetMonth,
        reason: "NOT_DUE",
      },
    };
  }
  if (!plan.active) {
    return {
      kind: "return",
      result: { kind: "no-data", planId: plan.planId, reason: "INACTIVE_PLAN" },
    };
  }
  if (!Number.isSafeInteger(plan.amountInWon) || plan.amountInWon <= 0) {
    return {
      kind: "return",
      result: {
        kind: "no-data",
        planId: plan.planId,
        reason: "NON_POSITIVE_PLAN_AMOUNT",
      },
    };
  }

  const payloadSignature = signature(input);
  const receipt = input.state.receipts.find(
    (candidate) => candidate.idempotencyKey === input.idempotencyKey,
  );
  if (receipt !== undefined) {
    if (receipt.payloadSignature !== payloadSignature) {
      return {
        kind: "return",
        result: {
          kind: "retryable-failure",
          planId: plan.planId,
          targetMonth: input.targetMonth,
          code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
        },
      };
    }
    return {
      kind: "return",
      result: {
        kind: "already-processed",
        planId: plan.planId,
        targetMonth: input.targetMonth,
        ledgerTransactionId: receipt.ledgerTransactionId,
      },
    };
  }

  const executionKey = `${plan.planId}:${input.targetMonth}`;
  const existing = input.state.executions.find(
    (execution) => execution.executionKey === executionKey,
  );
  if (existing !== undefined) {
    return {
      kind: "return",
      result: {
        kind: "already-processed",
        planId: plan.planId,
        targetMonth: input.targetMonth,
        ledgerTransactionId: existing.ledgerTransactionId,
      },
    };
  }

  const effectiveDate = resolveRecurringEffectiveDate(
    input.targetMonth,
    plan.dayOfMonth,
  );
  if (
    effectiveDate.kind !== "success" ||
    input.targetMonth < plan.firstApplicableMonth ||
    effectiveDate.localDate > input.asOfDate
  ) {
    return {
      kind: "return",
      result: {
        kind: "no-data",
        planId: plan.planId,
        targetMonth: input.targetMonth,
        reason: "NOT_DUE",
      },
    };
  }

  const transaction = {
    transactionId: input.ledgerTransactionId,
    recurringPlanId: plan.planId,
    recurringTargetMonth: input.targetMonth,
    transactionType: "expense" as const,
    source: "recurring" as const,
    originChannel: "recurring" as const,
    creatorMemberId: plan.creatorMemberId,
    merchant: plan.merchant,
    amountInWon: plan.amountInWon,
    categoryId: plan.categoryId,
    memo: plan.memo,
    accountingDate: effectiveDate.localDate,
  };
  const execution = {
    executionKey,
    planId: plan.planId,
    targetMonth: input.targetMonth,
    effectiveDate: effectiveDate.localDate,
    status: "completed" as const,
    ledgerTransactionId: input.ledgerTransactionId,
    processedAt: input.processedAt,
    version: 1,
  };
  const events: readonly RecurringProcessingEvent[] = [
    {
      eventType: "TransactionRecorded.v1",
      eventId: input.transactionEventId,
      planId: plan.planId,
      targetMonth: input.targetMonth,
      transactionId: input.ledgerTransactionId,
    },
    {
      eventType: "RecurringPlanProcessed.v1",
      eventId: input.processedEventId,
      planId: plan.planId,
      targetMonth: input.targetMonth,
      transactionId: input.ledgerTransactionId,
    },
  ];
  const result: ProcessRecurringTargetResult = {
    kind: "created",
    planId: plan.planId,
    targetMonth: input.targetMonth,
    effectiveDate: effectiveDate.localDate,
    ledgerTransactionId: input.ledgerTransactionId,
  };
  return {
    kind: "commit",
    nextState: {
      ...input.state,
      executions: [...input.state.executions, execution],
      ledgerTransactions: [...input.state.ledgerTransactions, transaction],
      receipts: [
        ...input.state.receipts,
        {
          idempotencyKey: input.idempotencyKey,
          payloadSignature,
          ledgerTransactionId: input.ledgerTransactionId,
        },
      ],
      outboxEvents: [...input.state.outboxEvents, ...events],
    },
    result,
    events,
  };
}

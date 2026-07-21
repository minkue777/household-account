import type {
  CategoryRemapPage,
  RecurringCategoryRemapDecision,
  RecurringCategoryRemapEvent,
  RecurringCategoryRemapState,
} from "../model/recurringCategoryRemap";

export function recurringCategoryRemapPayload(input: {
  fromCategoryId: string;
  toDefaultCategoryId: string;
  cursor?: string;
  limit: number;
}): string {
  return JSON.stringify([
    input.fromCategoryId,
    input.toDefaultCategoryId,
    input.cursor ?? null,
    input.limit,
  ]);
}

export function decideRecurringCategoryRemap(input: {
  state: RecurringCategoryRemapState;
  processId: string;
  fromCategoryId: string;
  toDefaultCategoryId: string;
  cursor?: string;
  limit: number;
  payloadHash: string;
}): RecurringCategoryRemapDecision {
  if (!Number.isSafeInteger(input.limit) || input.limit <= 0) {
    return {
      kind: "return",
      result: { kind: "validation-error", code: "INVALID_PAGE_LIMIT" },
    };
  }
  const receiptKey = `${input.processId}:recurring:${input.cursor ?? "START"}`;
  const replay = input.state.receipts.find(
    (receipt) => receipt.receiptKey === receiptKey,
  );
  if (replay !== undefined) {
    return replay.payloadHash === input.payloadHash
      ? {
          kind: "return",
          result: { kind: "already-processed", page: replay.page },
        }
      : {
          kind: "return",
          result: {
            kind: "conflict",
            code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
          },
        };
  }

  const candidates = input.state.plans
    .filter(
      (plan) =>
        plan.lifecycleState === "active" &&
        plan.categoryId === input.fromCategoryId &&
        (input.cursor === undefined || plan.planId > input.cursor),
    )
    .sort((left, right) => left.planId.localeCompare(right.planId));
  const selected = candidates.slice(0, input.limit);
  const hasMore = candidates.length > selected.length;
  const nextCursor = hasMore ? selected.at(-1)?.planId ?? null : null;
  const page: CategoryRemapPage = {
    processId: input.processId,
    fromCategoryId: input.fromCategoryId,
    toDefaultCategoryId: input.toDefaultCategoryId,
    changedCount: selected.length,
    nextCursor,
    completed: !hasMore,
  };
  const selectedIds = new Set(selected.map((plan) => plan.planId));
  const plans = input.state.plans.map((plan) =>
    selectedIds.has(plan.planId)
      ? {
          ...plan,
          categoryId: input.toDefaultCategoryId,
          version: plan.version + 1,
        }
      : plan,
  );
  const events: RecurringCategoryRemapEvent[] = selected.map((plan) => ({
    eventType: "RecurringPlanChanged.v1",
    planId: plan.planId,
    changeKind: "category-remapped",
    planVersion: plan.version + 1,
  }));
  return {
    kind: "commit",
    nextState: {
      ...input.state,
      plans,
      receipts: [
        ...input.state.receipts,
        {
          receiptKey,
          payloadHash: input.payloadHash,
          changedPlanIds: selected.map((plan) => plan.planId),
          page,
        },
      ],
      events: [...input.state.events, ...events],
    },
    result: { kind: "success", page },
    selectedPlanIds: selected.map((plan) => plan.planId),
  };
}

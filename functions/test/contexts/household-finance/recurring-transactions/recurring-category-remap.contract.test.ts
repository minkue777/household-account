import { describe, expect, it } from "vitest";
import { createRecurringCategoryRemapFixture } from "../../../support/recurring-category-remap-fixture";

interface RecurringCategoryPlanState {
  planId: string;
  categoryId: string;
  active: boolean;
  lifecycleState: "active" | "deleted";
  version: number;
}

interface HistoricalLedgerCategoryState {
  transactionId: string;
  recurringPlanId: string;
  categoryId: string;
}

interface CategoryRemapPage {
  processId: string;
  fromCategoryId: string;
  toDefaultCategoryId: string;
  changedCount: number;
  nextCursor: string | null;
  completed: boolean;
}

type CategoryRemapResult =
  | { kind: "success"; page: CategoryRemapPage }
  | { kind: "already-processed"; page: CategoryRemapPage }
  | { kind: "validation-error"; code: string }
  | { kind: "conflict"; code: string }
  | { kind: "retryable-failure"; code: string; retryCursor?: string };

interface CategoryRemapSnapshot {
  plans: readonly RecurringCategoryPlanState[];
  historicalLedgerTransactions: readonly HistoricalLedgerCategoryState[];
  receipts: readonly {
    receiptKey: string;
    payloadHash: string;
    changedPlanIds: readonly string[];
    nextCursor: string | null;
  }[];
  events: readonly {
    eventType: "RecurringPlanChanged.v1";
    planId: string;
    changeKind: "category-remapped";
    planVersion: number;
  }[];
}

interface CategoryRemapActor {
  kind: "system";
  capabilities: readonly "category-reference-remap"[];
}

export interface RecurringCategoryRemapSubject {
  remap(input: {
    actor: CategoryRemapActor;
    processId: string;
    fromCategoryId: string;
    toDefaultCategoryId: string;
    cursor?: string;
    limit: number;
  }): Promise<CategoryRemapResult>;
  clearPlanFailureForTest(planId: string): void;
  snapshot(): Promise<CategoryRemapSnapshot>;
}

export function createSubject(_fixture: {
  plans: readonly RecurringCategoryPlanState[];
  historicalLedgerTransactions?: readonly HistoricalLedgerCategoryState[];
  failPlanIds?: readonly string[];
}): RecurringCategoryRemapSubject {
  return createRecurringCategoryRemapFixture(_fixture);
}

const actor: CategoryRemapActor = {
  kind: "system",
  capabilities: ["category-reference-remap"],
};

function plan(
  planId: string,
  categoryId: string,
  overrides: Partial<RecurringCategoryPlanState> = {},
): RecurringCategoryPlanState {
  return {
    planId,
    categoryId,
    active: true,
    lifecycleState: "active",
    version: 1,
    ...overrides,
  };
}

describe("정기 거래 카테고리 참조 page remap 공개 계약", () => {
  it("[T-CAT-004][REC-005] active·inactive Plan을 page별 기본 카테고리로 수렴시키고 과거 Ledger는 보존한다", async () => {
    const historicalLedgerTransactions = [
      {
        transactionId: "past-active",
        recurringPlanId: "a-active",
        categoryId: "old",
      },
      {
        transactionId: "past-inactive",
        recurringPlanId: "b-inactive",
        categoryId: "old",
      },
    ];
    const subject = createSubject({
      plans: [
        plan("a-active", "old"),
        plan("b-inactive", "old", { active: false }),
        plan("c-already-default", "default"),
        plan("d-other", "other"),
      ],
      historicalLedgerTransactions,
    });
    const firstInput = {
      actor,
      processId: "archive-old",
      fromCategoryId: "old",
      toDefaultCategoryId: "default",
      limit: 1,
    } as const;

    const first = await subject.remap(firstInput);
    expect(first).toMatchObject({
      kind: "success",
      page: {
        processId: "archive-old",
        changedCount: 1,
        nextCursor: expect.any(String),
        completed: false,
      },
    });
    if (first.kind !== "success" || first.page.nextCursor === null) return;

    const replay = await subject.remap(firstInput);
    expect(replay).toEqual({ kind: "already-processed", page: first.page });
    const afterReplay = await subject.snapshot();
    expect(afterReplay.events).toHaveLength(1);
    expect(afterReplay.receipts).toHaveLength(1);

    const second = await subject.remap({
      ...firstInput,
      cursor: first.page.nextCursor,
    });
    expect(second).toEqual({
      kind: "success",
      page: {
        processId: "archive-old",
        fromCategoryId: "old",
        toDefaultCategoryId: "default",
        changedCount: 1,
        nextCursor: null,
        completed: true,
      },
    });

    const state = await subject.snapshot();
    expect(
      state.plans.map(({ planId, categoryId, active, version }) => ({
        planId,
        categoryId,
        active,
        version,
      })),
    ).toEqual([
      { planId: "a-active", categoryId: "default", active: true, version: 2 },
      {
        planId: "b-inactive",
        categoryId: "default",
        active: false,
        version: 2,
      },
      {
        planId: "c-already-default",
        categoryId: "default",
        active: true,
        version: 1,
      },
      { planId: "d-other", categoryId: "other", active: true, version: 1 },
    ]);
    expect(state.historicalLedgerTransactions).toEqual(
      historicalLedgerTransactions,
    );
    expect(state.receipts).toHaveLength(2);
    expect(state.events.map(({ planId }) => planId)).toEqual([
      "a-active",
      "b-inactive",
    ]);
  });

  it("[T-CAT-004][REC-005] page 저장 실패는 그 page Plan·receipt·Event를 전혀 바꾸지 않고 같은 cursor로 재시도한다", async () => {
    const subject = createSubject({
      plans: [plan("a", "old"), plan("b", "old")],
      failPlanIds: ["b"],
    });
    const first = await subject.remap({
      actor,
      processId: "archive-old",
      fromCategoryId: "old",
      toDefaultCategoryId: "default",
      limit: 1,
    });
    if (first.kind !== "success" || first.page.nextCursor === null) {
      throw new Error("첫 page checkpoint fixture가 필요합니다.");
    }
    const beforeFailure = await subject.snapshot();

    const failed = await subject.remap({
      actor,
      processId: "archive-old",
      fromCategoryId: "old",
      toDefaultCategoryId: "default",
      cursor: first.page.nextCursor,
      limit: 1,
    });

    expect(failed).toEqual({
      kind: "retryable-failure",
      code: "RECURRING_CATEGORY_REMAP_PAGE_FAILED",
      retryCursor: first.page.nextCursor,
    });
    expect(await subject.snapshot()).toEqual(beforeFailure);

    subject.clearPlanFailureForTest("b");
    await expect(
      subject.remap({
        actor,
        processId: "archive-old",
        fromCategoryId: "old",
        toDefaultCategoryId: "default",
        cursor: first.page.nextCursor,
        limit: 1,
      }),
    ).resolves.toMatchObject({
      kind: "success",
      page: { changedCount: 1, completed: true },
    });
    expect(
      (await subject.snapshot()).plans.map(({ categoryId }) => categoryId),
    ).toEqual(["default", "default"]);
  });

  it("[T-CAT-004][REC-005] 같은 process·cursor에 다른 remap payload를 재사용하면 기존 page 결과를 바꾸지 않는다", async () => {
    const subject = createSubject({ plans: [plan("a", "old")] });
    const original = {
      actor,
      processId: "archive-old",
      fromCategoryId: "old",
      toDefaultCategoryId: "default",
      limit: 1,
    } as const;
    await subject.remap(original);
    const beforeConflict = await subject.snapshot();

    const conflict = await subject.remap({
      ...original,
      toDefaultCategoryId: "another-default",
    });

    expect(conflict).toEqual({
      kind: "conflict",
      code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
    });
    expect(await subject.snapshot()).toEqual(beforeConflict);
  });
});

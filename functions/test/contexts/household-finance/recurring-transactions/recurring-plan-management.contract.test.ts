import { describe, expect, it } from "vitest";
import type {
  ManageRecurringPlanOperation,
  RecurringActor,
  RecurringPlanManagementInputPort,
  RecurringPlanView,
} from "../../../../src/contexts/household-finance/recurring/public";
import {
  createRecurringPlanManagementFixtureSubject,
  type RecurringPlanManagementFixture,
  type RecurringPlanManagementSnapshot,
} from "../../../support/recurring-plan-management-fixture";

export interface RecurringPlanManagementSubject
  extends RecurringPlanManagementInputPort {
  snapshot(): Promise<RecurringPlanManagementSnapshot>;
}

export function createSubject(
  fixture: RecurringPlanManagementFixture,
): RecurringPlanManagementSubject {
  return createRecurringPlanManagementFixtureSubject(fixture);
}

const actor: RecurringActor = {
  householdId: "house-1",
  actingMemberId: "member-a",
  capabilities: ["recurring.manage", "recurring.read"],
};

function plan(
  planId: string,
  overrides: Partial<RecurringPlanView> = {},
): RecurringPlanView {
  return {
    householdId: "house-1",
    planId,
    merchant: `가맹점-${planId}`,
    amountInWon: 10_000,
    categoryId: "fixed",
    dayOfMonth: 18,
    memo: "",
    active: true,
    creatorMemberId: "member-a",
    firstApplicableMonth: "2026-07",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    lifecycleState: "active",
    version: 1,
    ...overrides,
  };
}

describe("정기 거래 Plan 관리 공개 계약", () => {
  it("[T-REC-003][REC-001/REC-006] 정상 create는 전체 Plan 필드와 인증 Actor creator를 한 번만 저장한다", async () => {
    const subject = createSubject({
      now: "2026-07-17T01:23:45.000Z",
      usableCategoryIds: ["fixed"],
    });
    const command = {
      commandId: "create-plan-1",
      actor,
      operation: {
        kind: "create" as const,
        merchant: "  보험료  ",
        amountInWon: 120_000,
        categoryId: "fixed",
        dayOfMonth: 18,
        memo: "  가족 보험  ",
        active: true,
      },
    };

    const first = await subject.manage(command);
    const replay = await subject.manage(command);

    expect(first.kind).toBe("success");
    if (first.kind !== "success") return;
    expect(first.plan).toEqual({
      householdId: "house-1",
      planId: expect.any(String),
      merchant: "보험료",
      amountInWon: 120_000,
      categoryId: "fixed",
      dayOfMonth: 18,
      memo: "가족 보험",
      active: true,
      creatorMemberId: "member-a",
      firstApplicableMonth: "2026-07",
      createdAt: "2026-07-17T01:23:45.000Z",
      updatedAt: "2026-07-17T01:23:45.000Z",
      lifecycleState: "active",
      version: 1,
    });
    expect(replay).toEqual({ kind: "already-processed", plan: first.plan });
    expect(await subject.snapshot()).toEqual({
      plans: [first.plan],
      receipts: [
        {
          commandId: "create-plan-1",
          resultKind: "created",
          planId: first.plan.planId,
        },
      ],
      events: [
        {
          eventType: "RecurringPlanChanged.v1",
          planId: first.plan.planId,
          changeKind: "created",
          planVersion: 1,
        },
      ],
    });
  });

  it("[T-REC-003][REC-001] 같은 commandId를 다른 payload에 재사용하면 최초 결과를 덮어쓰지 않는다", async () => {
    const subject = createSubject({
      now: "2026-07-17T01:23:45.000Z",
      usableCategoryIds: ["fixed"],
    });
    const firstCommand = {
      commandId: "same-command",
      actor,
      operation: {
        kind: "create" as const,
        merchant: "보험료",
        amountInWon: 120_000,
        categoryId: "fixed",
        dayOfMonth: 18,
        active: true,
      },
    };
    expect((await subject.manage(firstCommand)).kind).toBe("success");
    const beforeConflict = await subject.snapshot();

    await expect(
      subject.manage({
        ...firstCommand,
        operation: { ...firstCommand.operation, amountInWon: 130_000 },
      }),
    ).resolves.toEqual({
      kind: "conflict",
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    expect(await subject.snapshot()).toEqual(beforeConflict);
  });

  it("[T-REC-003][REC-001] recurring.manage capability가 없는 Actor의 명령은 상태 변경 없이 거부한다", async () => {
    const subject = createSubject({
      now: "2026-07-17T01:23:45.000Z",
      usableCategoryIds: ["fixed"],
    });

    await expect(
      subject.manage({
        commandId: "unauthorized-create",
        actor: { ...actor, capabilities: ["recurring.read"] },
        operation: {
          kind: "create",
          merchant: "보험료",
          amountInWon: 120_000,
          categoryId: "fixed",
          dayOfMonth: 18,
          active: true,
        },
      }),
    ).resolves.toEqual({ kind: "forbidden", code: "CAPABILITY_REQUIRED" });
    expect(await subject.snapshot()).toEqual({
      plans: [],
      receipts: [],
      events: [],
    });
  });

  it.each([
    {
      name: "빈 가맹점",
      patch: { merchant: "   " },
      code: "MERCHANT_REQUIRED",
    },
    {
      name: "0원",
      patch: { amountInWon: 0 },
      code: "AMOUNT_NOT_POSITIVE_INTEGER",
    },
    {
      name: "음수 금액",
      patch: { amountInWon: -1 },
      code: "AMOUNT_NOT_POSITIVE_INTEGER",
    },
    {
      name: "소수 금액",
      patch: { amountInWon: 1.5 },
      code: "AMOUNT_NOT_POSITIVE_INTEGER",
    },
    {
      name: "0일",
      patch: { dayOfMonth: 0 },
      code: "DAY_OUT_OF_RANGE",
    },
    {
      name: "32일",
      patch: { dayOfMonth: 32 },
      code: "DAY_OUT_OF_RANGE",
    },
    {
      name: "사용 불가 카테고리",
      patch: { categoryId: "archived" },
      code: "CATEGORY_NOT_USABLE",
    },
  ])(
    "[T-REC-003][REC-001] $name create는 $code로 거부되고 Plan·receipt·Event를 남기지 않는다",
    async ({ patch, code }) => {
      const subject = createSubject({
        now: "2026-07-17T01:23:45.000Z",
        usableCategoryIds: ["fixed"],
      });
      const operation = {
        kind: "create" as const,
        merchant: "보험료",
        amountInWon: 10_000,
        categoryId: "fixed",
        dayOfMonth: 18,
        memo: "",
        active: true,
        ...patch,
      };

      const result = await subject.manage({
        commandId: `invalid-${code}`,
        actor,
        operation,
      });

      expect(result).toEqual({ kind: "validation-error", code });
      expect(await subject.snapshot()).toEqual({
        plans: [],
        receipts: [],
        events: [],
      });
    },
  );

  it("[T-REC-003][REC-001/REC-006] update는 모든 가변 필드를 바꾸되 최초 creator와 생성 정보는 보존한다", async () => {
    const existing = plan("plan-1");
    const subject = createSubject({
      now: "2026-07-20T03:00:00.000Z",
      usableCategoryIds: ["fixed", "etc"],
      plans: [existing],
    });

    const result = await subject.manage({
      commandId: "update-plan-1",
      actor: { ...actor, actingMemberId: "member-b" },
      operation: {
        kind: "update",
        planId: "plan-1",
        expectedVersion: 1,
        patch: {
          merchant: "변경 가맹점",
          amountInWon: 20_000,
          categoryId: "etc",
          dayOfMonth: 31,
          memo: "변경 메모",
          active: false,
        },
      },
    });

    expect(result).toEqual({
      kind: "success",
      plan: {
        ...existing,
        merchant: "변경 가맹점",
        amountInWon: 20_000,
        categoryId: "etc",
        dayOfMonth: 31,
        memo: "변경 메모",
        active: false,
        creatorMemberId: "member-a",
        updatedAt: "2026-07-20T03:00:00.000Z",
        version: 2,
      },
    });
  });

  it("[T-REC-003][REC-001] update도 양의 정수 금액 불변식을 적용하고 실패 시 기존 Plan·receipt·Event를 보존한다", async () => {
    const existing = plan("plan-1");
    const subject = createSubject({
      now: "2026-07-20T03:00:00.000Z",
      usableCategoryIds: ["fixed"],
      plans: [existing],
    });
    const before = await subject.snapshot();

    const result = await subject.manage({
      commandId: "update-plan-invalid-amount",
      actor,
      operation: {
        kind: "update",
        planId: "plan-1",
        expectedVersion: 1,
        patch: { amountInWon: 0 },
      },
    });

    expect(result).toEqual({
      kind: "validation-error",
      code: "AMOUNT_NOT_POSITIVE_INTEGER",
    });
    expect(await subject.snapshot()).toEqual(before);
  });

  it("[T-REC-003][REC-001/REC-006] create·update payload의 creator 주입은 schema 경계에서 거부한다", async () => {
    const existing = plan("plan-1");
    const subject = createSubject({
      now: "2026-07-20T03:00:00.000Z",
      usableCategoryIds: ["fixed"],
      plans: [existing],
    });
    const before = await subject.snapshot();
    const injectedOperation = {
      kind: "update",
      planId: "plan-1",
      expectedVersion: 1,
      patch: { merchant: "변경" },
      creatorMemberId: "member-attacker",
    } as unknown as ManageRecurringPlanOperation;

    const result = await subject.manage({
      commandId: "inject-creator",
      actor: { ...actor, actingMemberId: "member-b" },
      operation: injectedOperation,
    });

    expect(result).toEqual({
      kind: "validation-error",
      code: "CREATOR_FIELD_NOT_ALLOWED",
    });
    expect(await subject.snapshot()).toEqual(before);
  });

  it("[T-REC-003][REC-001] stale update와 없는 Plan 삭제는 typed 결과이며 기존 상태를 바꾸지 않는다", async () => {
    const existing = plan("plan-1", { version: 2 });
    const subject = createSubject({
      now: "2026-07-20T03:00:00.000Z",
      plans: [existing],
    });
    const before = await subject.snapshot();

    await expect(
      subject.manage({
        commandId: "stale-update",
        actor,
        operation: {
          kind: "update",
          planId: "plan-1",
          expectedVersion: 1,
          patch: { active: false },
        },
      }),
    ).resolves.toEqual({
      kind: "conflict",
      code: "PLAN_VERSION_MISMATCH",
      currentVersion: 2,
    });
    await expect(
      subject.manage({
        commandId: "delete-missing",
        actor,
        operation: {
          kind: "delete",
          planId: "missing",
          expectedVersion: 1,
        },
      }),
    ).resolves.toEqual({ kind: "not-found", code: "PLAN_NOT_FOUND" });
    expect(await subject.snapshot()).toEqual(before);
  });

  it("[T-REC-003][REC-001] stale delete도 현재 version을 반환하고 tombstone을 만들지 않는다", async () => {
    const existing = plan("plan-1", { version: 2 });
    const subject = createSubject({
      now: "2026-07-20T03:00:00.000Z",
      plans: [existing],
    });
    const before = await subject.snapshot();

    await expect(
      subject.manage({
        commandId: "stale-delete",
        actor,
        operation: {
          kind: "delete",
          planId: "plan-1",
          expectedVersion: 1,
        },
      }),
    ).resolves.toEqual({
      kind: "conflict",
      code: "PLAN_VERSION_MISMATCH",
      currentVersion: 2,
    });
    expect(await subject.snapshot()).toEqual(before);
  });

  it("[T-REC-003][REC-001] 타 가구 Plan의 update·delete는 같은 tenant 오류로 거부되고 상태가 불변이다", async () => {
    const otherHouseholdPlan = plan("plan-other", {
      householdId: "house-2",
      creatorMemberId: "member-other",
    });
    const subject = createSubject({
      now: "2026-07-20T03:00:00.000Z",
      plans: [otherHouseholdPlan],
    });
    const before = await subject.snapshot();

    await expect(
      subject.manage({
        commandId: "cross-tenant-update",
        actor,
        operation: {
          kind: "update",
          planId: otherHouseholdPlan.planId,
          expectedVersion: 1,
          patch: { active: false },
        },
      }),
    ).resolves.toEqual({
      kind: "forbidden",
      code: "HOUSEHOLD_SCOPE_REQUIRED",
    });
    await expect(
      subject.manage({
        commandId: "cross-tenant-delete",
        actor,
        operation: {
          kind: "delete",
          planId: otherHouseholdPlan.planId,
          expectedVersion: 1,
        },
      }),
    ).resolves.toEqual({
      kind: "forbidden",
      code: "HOUSEHOLD_SCOPE_REQUIRED",
    });
    expect(await subject.snapshot()).toEqual(before);
  });

  it("[T-REC-003][REC-001] delete는 Plan을 tombstone으로 보존하고 일반 목록에서 제외한다", async () => {
    const existing = plan("plan-1");
    const subject = createSubject({
      now: "2026-07-20T03:00:00.000Z",
      plans: [existing],
    });

    const result = await subject.manage({
      commandId: "delete-plan-1",
      actor,
      operation: { kind: "delete", planId: "plan-1", expectedVersion: 1 },
    });

    expect(result).toEqual({ kind: "deleted", planId: "plan-1", version: 2 });
    expect((await subject.snapshot()).plans).toEqual([
      {
        ...existing,
        updatedAt: "2026-07-20T03:00:00.000Z",
        lifecycleState: "deleted",
        version: 2,
      },
    ]);
    expect((await subject.snapshot()).receipts).toEqual([
      {
        commandId: "delete-plan-1",
        resultKind: "deleted",
        planId: "plan-1",
      },
    ]);
    expect((await subject.snapshot()).events).toEqual([
      {
        eventType: "RecurringPlanChanged.v1",
        planId: "plan-1",
        changeKind: "deleted",
        planVersion: 2,
      },
    ]);
    expect(
      await subject.list({ actor, householdId: "house-1", limit: 20 }),
    ).toEqual({
      kind: "no-data",
    });
  });

  it("[T-REC-003][REC-001] 목록은 active filter와 day·merchant·planId 정렬, cursor를 보존한다", async () => {
    const subject = createSubject({
      now: "2026-07-20T03:00:00.000Z",
      plans: [
        plan("c", { merchant: "나", dayOfMonth: 20 }),
        plan("b", { merchant: "가", dayOfMonth: 10 }),
        plan("a", { merchant: "가", dayOfMonth: 10 }),
        plan("inactive", { active: false, dayOfMonth: 1 }),
      ],
    });

    const first = await subject.list({
      actor,
      householdId: "house-1",
      active: true,
      limit: 2,
    });
    expect(first).toMatchObject({
      kind: "success",
      items: [{ planId: "a" }, { planId: "b" }],
      nextCursor: expect.any(String),
      sourceCheckpoint: expect.any(String),
    });
    if (first.kind !== "success" || !first.nextCursor) return;

    await expect(
      subject.list({
        actor,
        householdId: "house-1",
        active: true,
        cursor: first.nextCursor,
        limit: 2,
      }),
    ).resolves.toMatchObject({
      kind: "success",
      items: [{ planId: "c" }],
      sourceCheckpoint: first.sourceCheckpoint,
    });
    await expect(
      subject.list({
        actor,
        householdId: "house-1",
        active: false,
        limit: 2,
      }),
    ).resolves.toMatchObject({
      kind: "success",
      items: [{ planId: "inactive", active: false }],
    });
  });

  it("[T-REC-003][REC-001] 목록 Repository 실패를 빈 목록으로 바꾸지 않는다", async () => {
    const result = await createSubject({
      now: "2026-07-20T03:00:00.000Z",
      failList: true,
    }).list({ actor, householdId: "house-1", limit: 20 });

    expect(result).toEqual({
      kind: "retryable-failure",
      code: "RECURRING_PLAN_REPOSITORY_UNAVAILABLE",
    });
  });

  it("[T-REC-003][REC-001] 목록은 read capability와 Actor의 tenant가 모두 일치해야 한다", async () => {
    const subject = createSubject({
      now: "2026-07-20T03:00:00.000Z",
      plans: [plan("plan-1")],
    });

    await expect(
      subject.list({
        actor: { ...actor, capabilities: ["recurring.manage"] },
        householdId: "house-1",
        limit: 20,
      }),
    ).resolves.toEqual({ kind: "forbidden", code: "CAPABILITY_REQUIRED" });
    await expect(
      subject.list({
        actor,
        householdId: "house-2",
        limit: 20,
      }),
    ).resolves.toEqual({
      kind: "forbidden",
      code: "HOUSEHOLD_SCOPE_REQUIRED",
    });
  });
});

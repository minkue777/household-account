import { describe, expect, it } from "vitest";
import {
  createRecurringCreatorFixtureSubject,
  type MemberIdentitySeed,
  type RecurringCreatorFixture,
  type RecurringCreatorFixtureSubject,
  type RecurringTransactionSeed,
} from "../../../support/recurring-creator-fixture";

export interface RecurringCreatorContractSubject
  extends RecurringCreatorFixtureSubject {}

export function createSubject(
  fixture: RecurringCreatorFixture = {},
): RecurringCreatorContractSubject {
  return createRecurringCreatorFixtureSubject(fixture);
}

const members: readonly MemberIdentitySeed[] = [
  { householdId: "household-a", memberId: "member-a" },
  { householdId: "household-a", memberId: "member-b" },
  { householdId: "household-b", memberId: "member-other-household" },
];

describe("정기 거래 immutable creator·legacy mapping 공개 계약", () => {
  it("[T-REC-007][REC-006][DEC-063] Plan create는 인증된 최초 등록자를 creator로 저장한다", async () => {
    const subject = createSubject({ members });

    const result = await subject.createPlan({
      householdId: "household-a",
      actingMemberId: "member-a",
      merchant: "정기 결제",
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.plan.creatorMemberId).toBe("member-a");
  });

  it("[T-REC-007][REC-006][DEC-063] 다른 가구원이 Plan을 수정해도 최초 creator는 바뀌지 않는다", async () => {
    const subject = createSubject({ members });
    const created = await subject.createPlan({
      householdId: "household-a",
      actingMemberId: "member-a",
      merchant: "수정 전",
    });
    if (created.kind !== "success") throw new Error("fixture 생성 실패");

    const updated = await subject.updatePlan({
      householdId: "household-a",
      actingMemberId: "member-b",
      planId: created.plan.planId,
      merchant: "수정 후",
      expectedVersion: created.plan.version,
    });

    expect(updated.kind).toBe("success");
    if (updated.kind !== "success") return;
    expect(updated.plan).toMatchObject({
      merchant: "수정 후",
      creatorMemberId: "member-a",
    });
  });

  it("[T-REC-007][REC-006][DEC-063] Scheduler 거래는 SystemActor나 현재 멤버가 아니라 Plan creator를 사용한다", async () => {
    const subject = createSubject({ members });
    const created = await subject.createPlan({
      householdId: "household-a",
      actingMemberId: "member-a",
      merchant: "정기 결제",
    });
    if (created.kind !== "success") throw new Error("fixture 생성 실패");

    const result = await subject.processMonth({
      householdId: "household-a",
      planId: created.plan.planId,
      targetMonth: "2026-07",
      systemActorId: "recurring-scheduler",
      currentActiveMemberIds: ["member-b"],
    });

    expect(result).toMatchObject({
      kind: "created",
      transaction: {
        planId: created.plan.planId,
        creatorMemberId: "member-a",
        source: "recurring",
      },
    });
  });

  it("[T-REC-007][REC-006][DEC-063] creator 없는 legacy Plan은 유일한 현재 멤버가 있어도 추정하지 않고 거래를 만들지 않는다", async () => {
    const subject = createSubject({
      members: [{ householdId: "household-a", memberId: "member-b" }],
      legacyPlans: [
        { householdId: "household-a", planId: "legacy-plan", version: 1 },
      ],
    });

    const result = await subject.processMonth({
      householdId: "household-a",
      planId: "legacy-plan",
      targetMonth: "2026-07",
      systemActorId: "recurring-scheduler",
      currentActiveMemberIds: ["member-b"],
    });

    expect(result).toEqual({
      kind: "conflict",
      code: "LEGACY_CREATOR_MAPPING_REQUIRED",
    });
    expect(await subject.transactions()).toEqual([]);
  });

  it("[T-REC-007][REC-006][DEC-063] 다른 가구 Member를 legacy creator로 지정하면 write 없이 거부한다", async () => {
    const subject = createSubject({
      members,
      legacyPlans: [
        { householdId: "household-a", planId: "legacy-plan", version: 1 },
      ],
    });

    const result = await subject.mapLegacyCreator({
      householdId: "household-a",
      migrationActorId: "migration-admin",
      planId: "legacy-plan",
      creatorMemberId: "member-other-household",
      expectedVersion: 1,
    });

    expect(result).toEqual({
      kind: "validation-error",
      code: "CREATOR_MEMBER_NOT_IN_HOUSEHOLD",
    });
  });

  it("[T-REC-007][REC-006][DEC-063] stale version의 legacy mapping은 현재 version을 반환하고 creator를 설정하지 않는다", async () => {
    const subject = createSubject({
      members,
      legacyPlans: [
        { householdId: "household-a", planId: "legacy-plan", version: 2 },
      ],
    });

    await expect(
      subject.mapLegacyCreator({
        householdId: "household-a",
        migrationActorId: "migration-admin",
        planId: "legacy-plan",
        creatorMemberId: "member-a",
        expectedVersion: 1,
      }),
    ).resolves.toEqual({
      kind: "conflict",
      code: "PLAN_VERSION_MISMATCH",
      currentVersion: 2,
    });
    await expect(
      subject.processMonth({
        householdId: "household-a",
        planId: "legacy-plan",
        targetMonth: "2026-07",
        systemActorId: "recurring-scheduler",
        currentActiveMemberIds: ["member-a"],
      }),
    ).resolves.toEqual({
      kind: "conflict",
      code: "LEGACY_CREATOR_MAPPING_REQUIRED",
    });
    expect(await subject.transactions()).toEqual([]);
  });

  it("[T-REC-007][REC-006][DEC-063] 타 가구 scope로 legacy mapping·월 처리를 요청해도 Plan과 거래를 변경하지 않는다", async () => {
    const subject = createSubject({
      members,
      legacyPlans: [
        { householdId: "household-a", planId: "legacy-plan", version: 1 },
      ],
    });

    await expect(
      subject.mapLegacyCreator({
        householdId: "household-b",
        migrationActorId: "migration-admin",
        planId: "legacy-plan",
        creatorMemberId: "member-other-household",
        expectedVersion: 1,
      }),
    ).resolves.toEqual({
      kind: "forbidden",
      code: "HOUSEHOLD_SCOPE_REQUIRED",
    });
    await expect(
      subject.processMonth({
        householdId: "household-b",
        planId: "legacy-plan",
        targetMonth: "2026-07",
        systemActorId: "recurring-scheduler",
        currentActiveMemberIds: ["member-other-household"],
      }),
    ).resolves.toEqual({
      kind: "forbidden",
      code: "HOUSEHOLD_SCOPE_REQUIRED",
    });
    expect(await subject.transactions()).toEqual([]);
  });

  it("[T-REC-007][REC-006][DEC-063] 명시적 mapping 뒤에만 처리하고 재실행·다른 값으로 creator를 덮어쓰지 않는다", async () => {
    const subject = createSubject({
      members,
      legacyPlans: [
        { householdId: "household-a", planId: "legacy-plan", version: 1 },
      ],
    });
    const command = {
      householdId: "household-a",
      migrationActorId: "migration-admin",
      planId: "legacy-plan",
      creatorMemberId: "member-a",
      expectedVersion: 1,
    } as const;

    const mapped = await subject.mapLegacyCreator(command);
    expect(mapped.kind).toBe("success");
    if (mapped.kind !== "success") return;
    expect(mapped.plan.creatorMemberId).toBe("member-a");

    await expect(subject.mapLegacyCreator(command)).resolves.toMatchObject({
      kind: "already-processed",
      plan: { creatorMemberId: "member-a" },
    });
    await expect(
      subject.mapLegacyCreator({
        ...command,
        creatorMemberId: "member-b",
        expectedVersion: mapped.plan.version,
      }),
    ).resolves.toEqual({
      kind: "conflict",
      code: "CREATOR_ALREADY_ASSIGNED",
    });

    await expect(
      subject.processMonth({
        householdId: "household-a",
        planId: "legacy-plan",
        targetMonth: "2026-07",
        systemActorId: "recurring-scheduler",
        currentActiveMemberIds: ["member-b"],
      }),
    ).resolves.toMatchObject({
      kind: "created",
      transaction: { creatorMemberId: "member-a", source: "recurring" },
    });
  });

  it("[T-REC-007][REC-006][DEC-063] legacy mapping은 actor·시각·이전 version receipt와 변경 Event를 함께 남긴다", async () => {
    const subject = createSubject({
      members,
      legacyPlans: [
        { householdId: "household-a", planId: "legacy-plan", version: 1 },
      ],
    });

    await subject.mapLegacyCreator({
      householdId: "household-a",
      migrationActorId: "migration-admin",
      planId: "legacy-plan",
      creatorMemberId: "member-a",
      expectedVersion: 1,
    });

    expect(await subject.migrationAudit()).toEqual({
      receipts: [
        {
          householdId: "household-a",
          planId: "legacy-plan",
          creatorMemberId: "member-a",
          migrationActorId: "migration-admin",
          migratedAt: "2026-07-01T00:00:00.000Z",
          previousPlanVersion: 1,
        },
      ],
      events: [
        {
          eventType: "RecurringPlanChanged.v1",
          planId: "legacy-plan",
          changeKind: "updated",
          planVersion: 2,
        },
      ],
    });
  });

  it("[T-REC-007][REC-006][DEC-063] legacy creator mapping은 이미 생성된 과거 Ledger 거래를 소급 변경하지 않는다", async () => {
    const historicalTransaction: RecurringTransactionSeed = {
      transactionId: "historical-transaction",
      planId: "legacy-plan",
      creatorMemberId: "legacy-recorded-creator",
      source: "recurring",
    };
    const subject = createSubject({
      members,
      legacyPlans: [
        { householdId: "household-a", planId: "legacy-plan", version: 1 },
      ],
      transactions: [historicalTransaction],
    });

    const mapped = await subject.mapLegacyCreator({
      householdId: "household-a",
      migrationActorId: "migration-admin",
      planId: "legacy-plan",
      creatorMemberId: "member-a",
      expectedVersion: 1,
    });

    expect(mapped).toMatchObject({
      kind: "success",
      plan: { creatorMemberId: "member-a" },
    });
    expect(await subject.transactions()).toContainEqual(historicalTransaction);
  });
});

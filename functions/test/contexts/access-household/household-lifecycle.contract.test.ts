import { describe, expect, it } from "vitest";
import type {
  HouseholdLifecycleInputPort,
  VerifiedAdministrativeActor,
} from "../../../src/contexts/access/public";
import {
  createHouseholdLifecycleFixtureSubject,
  type HouseholdLifecycleFixture,
  type HouseholdLifecycleSnapshot,
} from "../../support/household-lifecycle-fixture";

/**
 * 논리 삭제·복구·수동 영구 purge 요청의 공개 경계입니다.
 * preservedData는 각 소유 Context의 최종 데이터 지문이며 Repository 호출을 관찰하지 않습니다.
 */
export interface HouseholdLifecycleSubject extends HouseholdLifecycleInputPort {
  setCurrentTime(instant: string): void;
  snapshot(): Promise<HouseholdLifecycleSnapshot>;
  publishedEvents(): ReturnType<
    ReturnType<typeof createHouseholdLifecycleFixtureSubject>["publishedEvents"]
  >;
}

export function createSubject(
  fixture: HouseholdLifecycleFixture,
): HouseholdLifecycleSubject {
  return createHouseholdLifecycleFixtureSubject(fixture);
}

const householdId = "household-lifecycle";

const claims = [
  {
    principalUid: "uid-a",
    householdId,
    membershipId: "membership-a",
    version: 3,
  },
  {
    principalUid: "uid-b",
    householdId,
    membershipId: "membership-b",
    version: 2,
  },
] as const;

const preservedData = {
  finance: "expense/category/recurring-digest",
  paymentCapture: "card/rule/dedup-digest",
  portfolio: "asset/holding/dividend-digest",
  notifications: "endpoint/delivery-digest",
};

const activeFixture = (): HouseholdLifecycleFixture => ({
  now: "2026-07-19T09:00:00.000Z",
  household: {
    householdId,
    lifecycleState: "active",
    aggregateVersion: 7,
  },
  membershipClaims: claims,
  preservedData,
});

const admin: VerifiedAdministrativeActor = {
  principalRef: "verified-admin",
  capabilities: ["household.delete", "household.restore"],
};

const purgeOperator: VerifiedAdministrativeActor = {
  principalRef: "verified-purge-operator",
  capabilities: [
    "household.delete",
    "household.restore",
    "household.purge.permanent",
    "household.purge.read",
  ],
};

async function logicallyDelete(subject: HouseholdLifecycleSubject) {
  const result = await subject.requestHouseholdDeletion(admin, {
    householdId,
    reason: "사용자 요청",
    expectedVersion: 7,
    idempotencyKey: "logical-delete",
  });
  expect(result.kind).toBe("success");
  if (result.kind !== "success") {
    throw new Error("테스트 준비용 논리 삭제에 실패했습니다.");
  }
  return result;
}

describe("가구 논리 삭제·복구·수동 purge 경계 공개 계약", () => {
  it("[T-ADM-002][ADM-003/DEC-016] 논리 삭제는 접근만 차단하고 모든 업무 데이터와 UID claim을 보존한다", async () => {
    const subject = createSubject(activeFixture());
    const deleted = await logicallyDelete(subject);

    expect(deleted.household).toEqual({
      householdId,
      lifecycleState: "deleted",
      aggregateVersion: 8,
      deletedAt: "2026-07-19T09:00:00.000Z",
    });
    await expect(subject.authorizeBusinessAccess(householdId)).resolves.toEqual({
      kind: "conflict",
      code: "HOUSEHOLD_NOT_ACTIVE",
    });

    const state = await subject.snapshot();
    expect(state.preservedData).toEqual(preservedData);
    expect(state.membershipClaims).toEqual(claims);
    expect(state.purgeProcess).toBeUndefined();
    expect(await subject.publishedEvents()).toContainEqual({
      eventType: "HouseholdDeleted.v1",
      householdId,
      deletedAt: "2026-07-19T09:00:00.000Z",
      deletedByHash: "hash:14",
    });
  });

  it("[T-ADM-002][ADM-003] 같은 논리 삭제 요청 재시도는 결과를 재생하고 Event를 중복 발행하지 않는다", async () => {
    const subject = createSubject(activeFixture());
    const first = await logicallyDelete(subject);
    const replay = await subject.requestHouseholdDeletion(admin, {
      householdId,
      reason: "사용자 요청",
      expectedVersion: 7,
      idempotencyKey: "logical-delete",
    });

    expect(replay).toEqual(first);
    expect(
      (await subject.publishedEvents()).filter(
        (event) => event.eventType === "HouseholdDeleted.v1",
      ),
    ).toHaveLength(1);
  });

  it("[T-ADM-002][ADM-003/DEC-016] purging 전의 deleted 가구는 같은 ID와 데이터를 그대로 active로 복구한다", async () => {
    const subject = createSubject(activeFixture());
    const deleted = await logicallyDelete(subject);
    subject.setCurrentTime("2026-07-20T02:30:00.000Z");

    const restored = await subject.restoreDeletedHousehold(admin, {
      householdId,
      reason: "오삭제 복구",
      expectedVersion: deleted.household.aggregateVersion,
      idempotencyKey: "restore-logical-delete",
    });

    expect(restored).toEqual({
      kind: "success",
      household: {
        householdId,
        lifecycleState: "active",
        aggregateVersion: 9,
      },
    });
    await expect(subject.authorizeBusinessAccess(householdId)).resolves.toEqual({
      kind: "allowed",
      householdId,
    });
    const state = await subject.snapshot();
    expect(state.preservedData).toEqual(preservedData);
    expect(state.membershipClaims).toEqual(claims);
    expect(await subject.publishedEvents()).toContainEqual({
      eventType: "HouseholdRestored.v1",
      householdId,
      restoredAt: "2026-07-20T02:30:00.000Z",
      restoredByHash: "hash:14",
    });
  });

  it("[T-ADM-002][ADM-003/DEC-016] 일반 삭제 권한만으로는 영구 purge를 시작할 수 없다", async () => {
    const subject = createSubject(activeFixture());
    const deleted = await logicallyDelete(subject);
    const before = await subject.snapshot();

    const result = await subject.requestPermanentHouseholdPurge(admin, {
      householdId,
      confirmation: "사용자 별도 영구 삭제 확인",
      expectedVersion: deleted.household.aggregateVersion,
      idempotencyKey: "purge-without-capability",
    });

    expect(result.kind).toBe("forbidden");
    const after = await subject.snapshot();
    expect(after).toEqual(before);
    expect(
      (await subject.publishedEvents()).filter(
        (event) => event.eventType === "HouseholdPermanentPurgeRequested.v1",
      ),
    ).toHaveLength(0);
  });

  it("[T-ADM-002][ADM-003/DEC-040] 별도 확인한 수동 요청은 purging Process만 만들고 그 요청 안에서 데이터·claim을 지우지 않는다", async () => {
    const subject = createSubject(activeFixture());
    const deleted = await logicallyDelete(subject);

    const result = await subject.requestPermanentHouseholdPurge(purgeOperator, {
      householdId,
      confirmation: "verified-user-request-ref",
      expectedVersion: deleted.household.aggregateVersion,
      idempotencyKey: "manual-permanent-purge",
    });

    expect(result).toEqual({
      kind: "success",
      household: {
        householdId,
        lifecycleState: "purging",
        aggregateVersion: 9,
        deletedAt: "2026-07-19T09:00:00.000Z",
      },
      processId: expect.any(String),
    });
    const state = await subject.snapshot();
    expect(state.purgeProcess).toEqual({
      processId: result.kind === "success" ? result.processId : "unreachable",
      status: "requested",
    });
    expect(state.preservedData).toEqual(preservedData);
    expect(state.membershipClaims).toEqual(claims);
    expect(await subject.publishedEvents()).toContainEqual({
      eventType: "HouseholdPermanentPurgeRequested.v1",
      householdId,
      processId: result.kind === "success" ? result.processId : "unreachable",
      confirmationRefHash: "hash:25",
    });
  });

  it("[T-ADM-002][ADM-003/DEC-016] purging이 시작된 뒤에는 복구할 수 없다", async () => {
    const subject = createSubject(activeFixture());
    const deleted = await logicallyDelete(subject);
    const accepted = await subject.requestPermanentHouseholdPurge(purgeOperator, {
      householdId,
      confirmation: "verified-user-request-ref",
      expectedVersion: deleted.household.aggregateVersion,
      idempotencyKey: "manual-permanent-purge",
    });
    if (accepted.kind !== "success") {
      throw new Error("테스트 준비용 purge 요청에 실패했습니다.");
    }
    const beforeRestore = await subject.snapshot();

    const restore = await subject.restoreDeletedHousehold(admin, {
      householdId,
      reason: "purging 복구 시도",
      expectedVersion: accepted.household.aggregateVersion,
      idempotencyKey: "restore-after-purge-started",
    });

    expect(restore.kind).toBe("conflict");
    const afterRestore = await subject.snapshot();
    expect(afterRestore).toEqual(beforeRestore);
    expect(
      (await subject.publishedEvents()).filter(
        (event) => event.eventType === "HouseholdRestored.v1",
      ),
    ).toHaveLength(0);
  });

  it("[T-ADM-002][ADM-003/DEC-016] active 가구에 대한 영구 purge 요청은 상태나 데이터를 바꾸지 않는다", async () => {
    const subject = createSubject(activeFixture());
    const before = await subject.snapshot();

    const result = await subject.requestPermanentHouseholdPurge(purgeOperator, {
      householdId,
      confirmation: "verified-user-request-ref",
      expectedVersion: 7,
      idempotencyKey: "purge-active-household",
    });

    expect(result.kind).toBe("conflict");
    expect(await subject.snapshot()).toEqual(before);
    expect(await subject.publishedEvents()).toHaveLength(0);
  });

  it.each(["delete", "restore"] as const)(
    "[T-ADM-002][ADM-003] %s capability가 없는 주체는 가구 상태를 바꾸지 못한다",
    async (operation) => {
      const subject = createSubject(activeFixture());
      if (operation === "restore") {
        await logicallyDelete(subject);
      }
      const before = await subject.snapshot();
      const actor: VerifiedAdministrativeActor = {
        principalRef: "unprivileged-actor",
        capabilities: [],
      };

      const result =
        operation === "delete"
          ? await subject.requestHouseholdDeletion(actor, {
              householdId,
              reason: "권한 없는 삭제",
              expectedVersion: before.household.aggregateVersion,
              idempotencyKey: "forbidden-delete",
            })
          : await subject.restoreDeletedHousehold(actor, {
              householdId,
              reason: "권한 없는 복구",
              expectedVersion: before.household.aggregateVersion,
              idempotencyKey: "forbidden-restore",
            });

      expect(result.kind).toBe("forbidden");
      expect(await subject.snapshot()).toEqual(before);
    },
  );

  it.each(["delete", "restore"] as const)(
    "[T-ADM-002][ADM-003] stale expectedVersion %s는 현재 version을 반환하고 상태를 보존한다",
    async (operation) => {
      const subject = createSubject(activeFixture());
      if (operation === "restore") {
        await logicallyDelete(subject);
      }
      const before = await subject.snapshot();
      const result =
        operation === "delete"
          ? await subject.requestHouseholdDeletion(admin, {
              householdId,
              reason: "stale 삭제",
              expectedVersion: 6,
              idempotencyKey: "stale-delete",
            })
          : await subject.restoreDeletedHousehold(admin, {
              householdId,
              reason: "stale 복구",
              expectedVersion: 7,
              idempotencyKey: "stale-restore",
            });

      expect(result).toEqual({
        kind: "conflict",
        code: "VERSION_MISMATCH",
        currentVersion: before.household.aggregateVersion,
      });
      expect(await subject.snapshot()).toEqual(before);
    },
  );

  it("[T-ADM-002][ADM-003] 같은 멱등 키의 다른 삭제 payload는 최초 결과를 보존하고 충돌한다", async () => {
    const subject = createSubject(activeFixture());
    await logicallyDelete(subject);
    const afterFirst = await subject.snapshot();

    const conflict = await subject.requestHouseholdDeletion(admin, {
      householdId,
      reason: "다른 삭제 사유",
      expectedVersion: 8,
      idempotencyKey: "logical-delete",
    });

    expect(conflict).toEqual({
      kind: "conflict",
      code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
    });
    expect(await subject.snapshot()).toEqual(afterFirst);
    expect(await subject.publishedEvents()).toHaveLength(1);
  });

  it("[T-ADM-002][ADM-003/DEC-040] 같은 영구 purge 요청 재전달은 같은 Process를 재생하고 Event를 중복 발행하지 않는다", async () => {
    const subject = createSubject(activeFixture());
    const deleted = await logicallyDelete(subject);
    const input = {
      householdId,
      confirmation: "verified-user-request-ref",
      expectedVersion: deleted.household.aggregateVersion,
      idempotencyKey: "replayed-permanent-purge",
    };

    const first = await subject.requestPermanentHouseholdPurge(
      purgeOperator,
      input,
    );
    const replay = await subject.requestPermanentHouseholdPurge(
      purgeOperator,
      input,
    );

    expect(replay).toEqual(first);
    expect(
      (await subject.publishedEvents()).filter(
        ({ eventType }) =>
          eventType === "HouseholdPermanentPurgeRequested.v1",
      ),
    ).toHaveLength(1);
  });

  it("[T-ADM-002][ADM-003/DEC-040] 별도 영구 삭제 확인이 비어 있으면 Process를 만들지 않는다", async () => {
    const subject = createSubject(activeFixture());
    const deleted = await logicallyDelete(subject);
    const before = await subject.snapshot();

    const result = await subject.requestPermanentHouseholdPurge(purgeOperator, {
      householdId,
      confirmation: "   ",
      expectedVersion: deleted.household.aggregateVersion,
      idempotencyKey: "missing-purge-confirmation",
    });

    expect(result).toEqual({
      kind: "conflict",
      code: "PURGE_CONFIRMATION_REQUIRED",
    });
    expect(await subject.snapshot()).toEqual(before);
    expect(
      (await subject.publishedEvents()).filter(
        ({ eventType }) =>
          eventType === "HouseholdPermanentPurgeRequested.v1",
      ),
    ).toHaveLength(0);
  });
});

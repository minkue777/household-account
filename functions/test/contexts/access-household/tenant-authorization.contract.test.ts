import { describe, expect, it } from "vitest";
import type {
  AuthenticatedTenantRequester,
  TenantAuthorizationInputPort,
  TenantCollection,
  TenantCrudAction,
  TenantOperation,
  TenantOperationResult,
} from "../../../src/contexts/access/public";
import {
  createTenantAuthorizationFixtureSubject,
  type TenantAuthorizationFixture,
  type TenantAuthorizationSnapshot,
} from "../../support/tenant-authorization-fixture";

/**
 * Firestore Rules와 서버 인가가 공유해야 하는 권한 행렬의 공개 seam입니다.
 * 거부 경로는 최종 데이터 snapshot으로 write 부재를 확인합니다.
 */
export interface TenantAuthorizationSubject
  extends TenantAuthorizationInputPort {
  execute(
    actor: AuthenticatedTenantRequester | undefined,
    operation: TenantOperation,
  ): Promise<TenantOperationResult>;
  snapshot(): Promise<TenantAuthorizationSnapshot>;
  publishedEvents(): Promise<readonly { eventType: string }[]>;
}

export function createSubject(
  fixture: TenantAuthorizationFixture = {},
): TenantAuthorizationSubject {
  return createTenantAuthorizationFixtureSubject(fixture);
}

const memberA: AuthenticatedTenantRequester = {
  kind: "member",
  principal: { uid: "uid-a" },
  wireHouseholdId: "house-a",
  wireMemberId: "member-a",
};

const administrator: AuthenticatedTenantRequester = {
  kind: "administrator",
  principalRef: "verified-admin",
  capabilities: ["admin.households.read", "admin.households.write"],
};

describe("가구 격리 Rules·인가 권한 행렬 공개 계약", () => {
  it.each<TenantCrudAction>(["read", "list", "create", "update", "delete"])(
    "[T-HH-RULES-001][T-SEC-001][SYS-001/ADM-002] 무인증 %s 요청은 데이터 존재 여부와 무관하게 거부되고 상태가 불변이다",
    async (action) => {
      const subject = createSubject();
      const before = await subject.snapshot();

      const result = await subject.execute(undefined, {
        action,
        collection: "transactions",
        recordId: "transaction-a",
        householdId: "house-a",
      });

      expect(result).toEqual({ kind: "unauthenticated", code: "AUTH_REQUIRED" });
      expect(await subject.snapshot()).toEqual(before);
      expect(await subject.publishedEvents()).toEqual([]);
    },
  );

  it.each<{
    label: string;
    actor: AuthenticatedTenantRequester;
    operation: TenantOperation;
  }>([
    {
      label: "인증 UID가 다른 가구의 household·member를 함께 사칭",
      actor: {
        kind: "member",
        principal: { uid: "uid-a" },
        wireHouseholdId: "house-b",
        wireMemberId: "member-b",
      },
      operation: {
        action: "read",
        collection: "transactions",
        recordId: "transaction-b",
        householdId: "house-b",
      },
    },
    {
      label: "인증 UID가 같은 가구의 다른 member를 사칭",
      actor: {
        kind: "member",
        principal: { uid: "uid-a" },
        wireHouseholdId: "house-a",
        wireMemberId: "member-b",
      },
      operation: {
        action: "read",
        collection: "transactions",
        recordId: "transaction-a",
        householdId: "house-a",
      },
    },
    {
      label: "Membership 없는 UID가 유효한 household·member를 사칭",
      actor: {
        kind: "member",
        principal: { uid: "uid-unknown" },
        wireHouseholdId: "house-a",
        wireMemberId: "member-a",
      },
      operation: {
        action: "read",
        collection: "transactions",
        recordId: "transaction-a",
        householdId: "house-a",
      },
    },
  ])(
    "[T-HH-RULES-001][T-SEC-001][SYS-001] $label 요청은 wire 값을 권위로 사용하지 않는다",
    async ({ actor, operation }) => {
      const subject = createSubject();
      const before = await subject.snapshot();

      await expect(subject.execute(actor, operation)).resolves.toEqual({
        kind: "forbidden",
        code: "HOUSEHOLD_SCOPE_REQUIRED",
      });
      expect(await subject.snapshot()).toEqual(before);
      expect(await subject.publishedEvents()).toEqual([]);
    },
  );

  it("[T-HH-RULES-001][T-SEC-001][HH-012] removed Membership은 과거 식별자가 일치해도 접근할 수 없다", async () => {
    const subject = createSubject({
      memberships: [
        {
          principalUid: "uid-a",
          householdId: "house-a",
          memberId: "member-a",
          status: "removed",
        },
      ],
    });
    const before = await subject.snapshot();

    await expect(
      subject.execute(memberA, {
        action: "read",
        collection: "transactions",
        recordId: "transaction-a",
        householdId: "house-a",
      }),
    ).resolves.toEqual({
      kind: "forbidden",
      code: "HOUSEHOLD_SCOPE_REQUIRED",
    });
    expect(await subject.snapshot()).toEqual(before);
  });

  it("[T-HH-RULES-001][T-SEC-001][SYS-001] wire tenant를 자기 가구로 써도 실제 레코드의 다른 가구 소유권을 우회하지 못한다", async () => {
    const subject = createSubject();
    const before = await subject.snapshot();

    await expect(
      subject.execute(memberA, {
        action: "read",
        collection: "transactions",
        recordId: "transaction-b",
        householdId: "house-a",
      }),
    ).resolves.toEqual({
      kind: "forbidden",
      code: "HOUSEHOLD_SCOPE_REQUIRED",
    });
    expect(await subject.snapshot()).toEqual(before);
  });

  it.each<TenantCollection>([
    "transactions",
    "categories",
    "recurringPlans",
    "localCurrencyBalances",
    "assets",
  ])(
    "[T-HH-RULES-001][T-SEC-001][SYS-001] 사용자 편집 %s 생성은 명시적인 같은 householdId에서만 허용한다",
    async (collection) => {
      const subject = createSubject();
      const before = await subject.snapshot();

      await expect(
        subject.execute(memberA, {
          action: "create",
          collection,
          recordId: `${collection}-missing-tenant`,
          nextHouseholdId: undefined,
        }),
      ).resolves.toEqual({
        kind: "validation-error",
        code: "HOUSEHOLD_ID_REQUIRED",
      });
      await expect(
        subject.execute(memberA, {
          action: "create",
          collection,
          recordId: `${collection}-other-tenant`,
          householdId: "house-b",
          nextHouseholdId: "house-b",
        }),
      ).resolves.toEqual({
        kind: "forbidden",
        code: "HOUSEHOLD_SCOPE_REQUIRED",
      });
      expect(await subject.snapshot()).toEqual(before);

      await expect(
        subject.execute(memberA, {
          action: "create",
          collection,
          recordId: `${collection}-house-a`,
          householdId: "house-a",
          nextHouseholdId: "house-a",
        }),
      ).resolves.toEqual({
        kind: "allowed",
        changedRecordId: `${collection}-house-a`,
      });
      expect((await subject.snapshot()).records).toHaveProperty(
        `${collection}-house-a`,
        expect.objectContaining({ collection, householdId: "house-a" }),
      );
    },
  );

  it("[T-HH-RULES-001][T-SEC-001][SYS-001] 같은 가구의 사용자 편집 컬렉션 CRUD와 query는 자기 tenant 범위에서만 허용된다", async () => {
    const subject = createSubject();

    await expect(
      subject.execute(memberA, {
        action: "read",
        collection: "transactions",
        recordId: "transaction-a",
        householdId: "house-a",
      }),
    ).resolves.toEqual({ kind: "allowed" });
    await expect(
      subject.execute(memberA, {
        action: "list",
        collection: "transactions",
        householdId: "house-a",
      }),
    ).resolves.toEqual({
      kind: "allowed",
      visibleRecordIds: ["transaction-a"],
    });
    await expect(
      subject.execute(memberA, {
        action: "create",
        collection: "transactions",
        recordId: "transaction-new-a",
        householdId: "house-a",
        nextHouseholdId: "house-a",
      }),
    ).resolves.toEqual({
      kind: "allowed",
      changedRecordId: "transaction-new-a",
    });
    await expect(
      subject.execute(memberA, {
        action: "update",
        collection: "transactions",
        recordId: "transaction-new-a",
        householdId: "house-a",
        nextHouseholdId: "house-a",
      }),
    ).resolves.toEqual({
      kind: "allowed",
      changedRecordId: "transaction-new-a",
    });
    await expect(
      subject.execute(memberA, {
        action: "delete",
        collection: "transactions",
        recordId: "transaction-new-a",
        householdId: "house-a",
      }),
    ).resolves.toEqual({
      kind: "allowed",
      changedRecordId: "transaction-new-a",
    });

    const state = await subject.snapshot();
    expect(state.records).toHaveProperty("transaction-a");
    expect(state.records).not.toHaveProperty("transaction-new-a");
  });

  it.each<TenantCrudAction>(["read", "list", "create", "update", "delete"])(
    "[T-HH-RULES-001][T-SEC-001][SYS-001] 다른 가구의 %s 요청은 동일한 scope 오류이며 어느 tenant도 변경하지 않는다",
    async (action) => {
      const subject = createSubject();
      const before = await subject.snapshot();

      const result = await subject.execute(memberA, {
        action,
        collection: "transactions",
        recordId: "transaction-b",
        householdId: "house-b",
        nextHouseholdId: "house-b",
      });

      expect(result).toEqual({
        kind: "forbidden",
        code: "HOUSEHOLD_SCOPE_REQUIRED",
      });
      expect(await subject.snapshot()).toEqual(before);
      expect(await subject.publishedEvents()).toEqual([]);
    },
  );

  it.each([
    [undefined, "HOUSEHOLD_ID_REQUIRED"],
    ["house-b", "HOUSEHOLD_ID_IMMUTABLE"],
  ] as const)(
    "[T-HH-RULES-001][T-SEC-001][SYS-001] update의 next householdId=%s는 %s로 거부된다",
    async (nextHouseholdId, expectedCode) => {
      const subject = createSubject();
      const before = await subject.snapshot();

      const result = await subject.execute(memberA, {
        action: "update",
        collection: "transactions",
        recordId: "transaction-a",
        householdId: "house-a",
        nextHouseholdId,
      });

      expect(result).toEqual({
        kind: "validation-error",
        code: expectedCode,
      });
      expect(await subject.snapshot()).toEqual(before);
    },
  );

  it.each<TenantCollection>([
    "notificationEndpoints",
    "notificationDebugLogs",
    "providerHealth",
  ])(
    "[T-HH-RULES-001][T-SEC-001][ADM-002] 같은 가구 Member도 서버 전용 %s 컬렉션을 직접 읽거나 쓸 수 없다",
    async (collection) => {
      const subject = createSubject();
      const before = await subject.snapshot();

      await expect(
        subject.execute(memberA, {
          action: "read",
          collection,
          recordId: `${collection}-a`,
          householdId: "house-a",
        }),
      ).resolves.toEqual({
        kind: "forbidden",
        code: "SERVER_ONLY_COLLECTION",
      });
      await expect(
        subject.execute(memberA, {
          action: "update",
          collection,
          recordId: `${collection}-a`,
          householdId: "house-a",
          nextHouseholdId: "house-a",
        }),
      ).resolves.toEqual({
        kind: "forbidden",
        code: "SERVER_ONLY_COLLECTION",
      });
      expect(await subject.snapshot()).toEqual(before);
      expect(await subject.publishedEvents()).toEqual([]);
    },
  );

  it("[T-HH-RULES-001][T-SEC-001][ADM-002] 검증된 관리자 capability는 가구 관리만 허용하고 서버 전용 금융·endpoint write로 확장되지 않는다", async () => {
    const subject = createSubject();

    await expect(
      subject.execute(administrator, {
        action: "list",
        collection: "households",
      }),
    ).resolves.toEqual({
      kind: "allowed",
      visibleRecordIds: ["house-a", "house-b"],
    });
    await expect(
      subject.execute(administrator, {
        action: "update",
        collection: "households",
        recordId: "house-a",
        householdId: "house-a",
        nextHouseholdId: "house-a",
      }),
    ).resolves.toEqual({ kind: "allowed", changedRecordId: "house-a" });
    await expect(
      subject.execute(administrator, {
        action: "update",
        collection: "notificationEndpoints",
        recordId: "endpoint-a",
        householdId: "house-a",
        nextHouseholdId: "house-a",
      }),
    ).resolves.toEqual({
      kind: "forbidden",
      code: "SERVER_ONLY_COLLECTION",
    });
  });
});

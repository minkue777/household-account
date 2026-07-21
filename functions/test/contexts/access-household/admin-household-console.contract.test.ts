import { describe, expect, it } from "vitest";
import type {
  AdminHouseholdConsoleInputPort,
  VerifiedAdminActor,
} from "../../../src/contexts/access/public";
import {
  createAdminHouseholdConsoleFixtureSubject,
  type AdminConsoleEvent,
  type AdminConsoleSnapshot,
} from "../../support/admin-household-console-fixture";

/**
 * 현재 관리자 화면의 공개 Controller 계약입니다.
 * 복사는 Presentation effect, 삭제는 데이터 보존형 lifecycle 결과로 관찰합니다.
 */
export interface AdminHouseholdConsoleSubject
  extends AdminHouseholdConsoleInputPort {
  snapshot(): Promise<AdminConsoleSnapshot>;
  publishedEvents(): Promise<readonly AdminConsoleEvent[]>;
}

export function createSubject(): AdminHouseholdConsoleSubject {
  return createAdminHouseholdConsoleFixtureSubject();
}

const allowedAdmin: VerifiedAdminActor = {
  principalRef: "verified-admin",
  capabilities: [
    "admin.households.read",
    "admin.households.write",
    "household.delete",
  ],
};

describe("관리자 가구 화면 공개 계약", () => {
  it("[T-ADM-001][ADM-001] 허용된 Google 관리자는 최신순·안정 ID 보조 정렬로 가구 page를 조회한다", async () => {
    const subject = createSubject();
    await expect(subject.open(allowedAdmin)).resolves.toEqual({
      kind: "success",
      value: "opened",
    });

    const result = await subject.listHouseholds({ limit: 2 });

    expect(result).toEqual({
      kind: "success",
      value: {
        items: [
          expect.objectContaining({ householdId: "house-newer" }),
          expect.objectContaining({ householdId: "house-older" }),
        ],
        nextCursor: expect.any(String),
      },
    });
    if (result.kind === "success") {
      expect(
        result.value.items.map(({ createdAt, householdId }) => ({
          createdAt,
          householdId,
        })),
      ).toEqual([
        { createdAt: "2026-07-20T01:00:00.000Z", householdId: "house-newer" },
        { createdAt: "2026-07-19T01:00:00.000Z", householdId: "house-older" },
      ]);
    }
  });

  it("[T-ADM-001][ADM-001] 관리자는 가구를 생성하고 현재 전환 기간의 키를 Presentation에서 복사할 수 있다", async () => {
    const subject = createSubject();
    await subject.open(allowedAdmin);

    const created = await subject.createHousehold({
      name: "운영 생성 가계부",
      idempotencyKey: "admin-create-household",
    });
    expect(created).toEqual({
      kind: "success",
      value: expect.objectContaining({
        householdId: expect.any(String),
        name: "운영 생성 가계부",
        lifecycleState: "active",
        legacyShareKey: expect.any(String),
      }),
    });
    if (created.kind !== "success") {
      throw new Error("테스트 준비용 관리자 가구 생성에 실패했습니다.");
    }

    await expect(
      subject.copyLegacyShareKey(created.value.householdId),
    ).resolves.toEqual({ kind: "success", value: { copied: true } });
    const state = await subject.snapshot();
    expect(state.households).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          householdId: created.value.householdId,
          lifecycleState: "active",
        }),
      ]),
    );
    expect(state.presentationEffects).toEqual([
      {
        kind: "clipboard-copy",
        text: created.value.legacyShareKey,
      },
    ]);
    expect(await subject.publishedEvents()).toEqual([
      {
        eventType: "HouseholdCreated.v1",
        householdId: created.value.householdId,
      },
    ]);
  });

  it("[T-ADM-001][ADM-001/ADM-003] 삭제 확인 전에는 변경하지 않고 확인 뒤에는 물리 제거 대신 deleted 상태를 관찰한다", async () => {
    const subject = createSubject();
    await subject.open(allowedAdmin);
    const before = await subject.snapshot();

    await expect(
      subject.deleteHousehold({
        householdId: "house-older",
        confirmed: false,
        expectedVersion: 4,
        idempotencyKey: "admin-delete-not-confirmed",
      }),
    ).resolves.toEqual({
      kind: "validation-error",
      code: "DELETION_CONFIRMATION_REQUIRED",
    });
    expect(await subject.snapshot()).toEqual(before);

    const deleted = await subject.deleteHousehold({
      householdId: "house-older",
      confirmed: true,
      expectedVersion: 4,
      idempotencyKey: "admin-delete-confirmed",
    });

    expect(deleted).toEqual({
      kind: "success",
      value: expect.objectContaining({
        householdId: "house-older",
        lifecycleState: "deleted",
        aggregateVersion: 5,
      }),
    });
    expect((await subject.snapshot()).households).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          householdId: "house-older",
          lifecycleState: "deleted",
        }),
      ]),
    );
    expect(await subject.publishedEvents()).toEqual([
      { eventType: "HouseholdDeleted.v1", householdId: "house-older" },
    ]);
  });

  it("[T-ADM-001][ADM-001/ADM-002] 허용되지 않은 계정은 관리자 화면과 이후 명령을 사용할 수 없다", async () => {
    const subject = createSubject();
    const before = await subject.snapshot();

    await expect(
      subject.open({ principalRef: "ordinary-user", capabilities: [] }),
    ).resolves.toEqual({
      kind: "forbidden",
      code: "ADMIN_CAPABILITY_REQUIRED",
    });
    await expect(subject.listHouseholds({ limit: 10 })).resolves.toEqual({
      kind: "forbidden",
      code: "ADMIN_CAPABILITY_REQUIRED",
    });
    expect(await subject.snapshot()).toEqual(before);
    expect(await subject.publishedEvents()).toEqual([]);
  });

  it("[T-ADM-001][ADM-002] 이메일처럼 보이는 Presentation 입력은 서버 capability를 대신하지 않는다", async () => {
    const subject = createSubject();
    const actorWithUntrustedPresentationField = {
      principalRef: "ordinary-user-with-admin-looking-email",
      capabilities: [] as const,
      email: "allowed-admin@example.com",
    };

    await expect(
      subject.open(actorWithUntrustedPresentationField),
    ).resolves.toEqual({
      kind: "forbidden",
      code: "ADMIN_CAPABILITY_REQUIRED",
    });
    expect(await subject.publishedEvents()).toEqual([]);
  });
});

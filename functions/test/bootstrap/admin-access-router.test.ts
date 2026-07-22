import { describe, expect, it } from "vitest";

import {
  createAdminAccessRouter,
  type AdminAccessHandler,
} from "../../src/bootstrap/admin/adminAccess";
import { verifiedSystemAdministrator } from "../../src/bootstrap/verifiedSystemAdministrator";

const request = {
  contractVersion: "admin-access.v1",
  requestId: "admin-request-1",
  idempotencyKey: "admin-request-1",
  operation: "list-households",
  payload: { limit: 50 },
};

function fixture() {
  let executions = 0;
  const handler: AdminAccessHandler = {
    async execute(context) {
      executions += 1;
      return { principalRef: context.administrator.principalRef };
    },
  };
  return {
    router: createAdminAccessRouter({
      handlers: new Map([["list-households", handler]]),
    }),
    executions: () => executions,
  };
}

describe("systemAdmin 전용 관리자 callable 경계", () => {
  it("Firebase가 검증한 systemAdmin claim만 고정 capability로 변환한다", () => {
    expect(verifiedSystemAdministrator("uid-admin", { systemAdmin: true })).toEqual({
      principalRef: "uid-admin",
      capabilities: [
        "admin.households.read",
        "admin.households.write",
        "admin.household-data.read",
        "household.delete",
        "household.restore",
        "admin.asset-owner-profile.archive",
        "admin.household-members.remove",
        "admin.household-members.restore",
        "portfolio.asset.restore.deleted",
        "portfolio.asset.restore.read",
      ],
    });
    expect(
      verifiedSystemAdministrator("uid-admin", {
        email: "minkue777@gmail.com",
        capabilities: ["admin.households.write"],
      }),
    ).toBeUndefined();
  });

  it("로그인했어도 systemAdmin claim이 없으면 전역 가구 조회를 실행하지 않는다", async () => {
    const subject = fixture();
    await expect(
      subject.router.execute({
        principalUid: "uid-user",
        administrator: undefined,
        request,
        requestedAt: "2026-07-21T09:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      kind: "error",
      code: "ADMIN_CAPABILITY_REQUIRED",
    });
    expect(subject.executions()).toBe(0);
  });

  it("클라이언트 payload의 이메일·capability 위조는 handler 전에 거부한다", async () => {
    const subject = fixture();
    const administrator = verifiedSystemAdministrator("uid-admin", {
      systemAdmin: true,
    });
    await expect(
      subject.router.execute({
        principalUid: "uid-admin",
        administrator,
        request: {
          ...request,
          payload: {
            limit: 50,
            email: "minkue777@gmail.com",
            capabilities: ["admin.households.write"],
          },
        },
        requestedAt: "2026-07-21T09:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      kind: "error",
      code: "FORBIDDEN_IDENTITY_FIELD",
    });
    expect(subject.executions()).toBe(0);
  });

  it("검증된 관리자와 인증 UID가 일치할 때만 요청을 실행한다", async () => {
    const subject = fixture();
    const administrator = verifiedSystemAdministrator("uid-admin", {
      systemAdmin: true,
    });
    await expect(
      subject.router.execute({
        principalUid: "uid-admin",
        administrator,
        request,
        requestedAt: "2026-07-21T09:00:00.000Z",
      }),
    ).resolves.toEqual({
      kind: "success",
      requestId: "admin-request-1",
      data: { principalRef: "uid-admin" },
    });
    expect(subject.executions()).toBe(1);

    await expect(
      subject.router.execute({
        principalUid: "uid-other",
        administrator,
        request,
        requestedAt: "2026-07-21T09:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      kind: "error",
      code: "ADMIN_CAPABILITY_REQUIRED",
    });
  });
});

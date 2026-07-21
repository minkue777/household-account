import { describe, expect, it } from "vitest";
import type {
  EndpointLifecycleInputPort,
  RegisterEndpointCommand,
  RemoveEndpointCommand,
} from "../../../src/contexts/notifications/public";
import {
  createEndpointLifecycleFixtureSubject,
  type EndpointLifecycleFixture,
  type EndpointSeed,
} from "../../support/endpoint-lifecycle-driver";

export interface EndpointLifecycleContractSubject
  extends EndpointLifecycleInputPort {}

export function createSubject(
  fixture: EndpointLifecycleFixture = {},
): EndpointLifecycleContractSubject {
  return createEndpointLifecycleFixtureSubject(fixture);
}

const actor = (memberId: string, householdId = "house-1") => ({
  uid: `uid-${memberId}`,
  householdId,
  memberId,
});

const registration = (
  overrides: Partial<RegisterEndpointCommand> = {},
): RegisterEndpointCommand => ({
  commandId: "register-1",
  idempotencyKey: "register-key-1",
  actor: actor("member-1"),
  appAttestation: "valid",
  fid: "FID-A",
  platform: "android",
  now: "2026-07-19T09:00:00.000Z",
  ...overrides,
});

const activeSeed = (overrides: Partial<EndpointSeed> = {}): EndpointSeed => ({
  endpointId: "endpoint-a",
  fid: "FID-A",
  householdId: "house-1",
  memberId: "member-1",
  platform: "android",
  status: "active",
  registrationVersion: 1,
  bindingVersion: 1,
  lastConfirmedAt: "2026-07-18T09:00:00.000Z",
  ...overrides,
});

describe("NotificationEndpoint 수명주기 공개 계약", () => {
  it("[T-PUSH-004][PUSH-002/PUSH-008][DEC-020] 한 멤버의 서로 다른 FID는 서로 덮어쓰지 않는 두 활성 endpoint가 된다", async () => {
    const subject = createSubject();

    const first = await subject.register(registration());
    const second = await subject.register(
      registration({
        commandId: "register-2",
        idempotencyKey: "register-key-2",
        fid: "FID-B",
        platform: "ios-pwa",
      }),
    );

    expect(first).toMatchObject({ kind: "EndpointRegistered", result: "created" });
    expect(second).toMatchObject({ kind: "EndpointRegistered", result: "created" });
    expect(first.kind === "EndpointRegistered" && second.kind === "EndpointRegistered"
      ? first.endpointId
      : undefined).not.toBe(
      first.kind === "EndpointRegistered" && second.kind === "EndpointRegistered"
        ? second.endpointId
        : undefined,
    );
    expect(await subject.listEndpointViews("house-1")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ memberId: "member-1", platform: "android", status: "active" }),
        expect.objectContaining({ memberId: "member-1", platform: "ios-pwa", status: "active" }),
      ]),
    );
    const activeEndpoints = await subject.listEndpointViews("house-1");
    expect(activeEndpoints).toHaveLength(2);
    expect(
      activeEndpoints.every(
        (endpoint) =>
          !("inactiveAt" in endpoint) && !("expiresAt" in endpoint),
      ),
    ).toBe(true);
  });

  it("[T-PUSH-004][PUSH-003/PUSH-008] 같은 FID 재등록은 endpoint를 추가하지 않고 확인 시각과 registration version을 갱신한다", async () => {
    const subject = createSubject({ endpoints: [activeSeed()] });

    const result = await subject.register(
      registration({
        commandId: "refresh-a",
        idempotencyKey: "refresh-a",
        now: "2026-07-19T10:00:00.000Z",
      }),
    );

    expect(result).toEqual({
      kind: "EndpointRegistered",
      endpointId: "endpoint-a",
      result: "refreshed",
      registrationVersion: 2,
    });
    expect(await subject.listEndpointViews("house-1")).toEqual([
      expect.objectContaining({
        endpointId: "endpoint-a",
        memberId: "member-1",
        status: "active",
        registrationVersion: 2,
        bindingVersion: 1,
        lastConfirmedAt: "2026-07-19T10:00:00.000Z",
      }),
    ]);
    expect((await subject.listEndpointViews("house-1"))[0]).not.toHaveProperty(
      "expiresAt",
    );
  });

  it("[T-PUSH-004][PUSH-003/PUSH-008][DEC-027] inactive endpoint의 같은 FID 재등록은 같은 ID를 활성화하고 inactive TTL 필드를 제거한다", async () => {
    const subject = createSubject({
      endpoints: [
        activeSeed({
          status: "inactive",
          inactiveAt: "2026-07-18T10:00:00.000Z",
          expiresAt: "2026-08-17T10:00:00.000Z",
        }),
      ],
    });

    const result = await subject.register(
      registration({
        commandId: "reactivate-a",
        idempotencyKey: "reactivate-a",
        now: "2026-07-19T10:00:00.000Z",
      }),
    );

    expect(result).toEqual({
      kind: "EndpointRegistered",
      endpointId: "endpoint-a",
      result: "refreshed",
      registrationVersion: 2,
    });
    const [endpoint] = await subject.listEndpointViews("house-1");
    expect(endpoint).toEqual(
      expect.objectContaining({
        endpointId: "endpoint-a",
        status: "active",
        registrationVersion: 2,
        lastConfirmedAt: "2026-07-19T10:00:00.000Z",
      }),
    );
    expect(endpoint).not.toHaveProperty("inactiveAt");
    expect(endpoint).not.toHaveProperty("expiresAt");
  });

  it("[T-PUSH-004][PUSH-003/PUSH-008] 같은 command key와 payload 재전달은 최초 등록 결과를 재생하고 version을 다시 증가시키지 않는다", async () => {
    const subject = createSubject({ endpoints: [activeSeed()] });
    const command = registration({
      commandId: "refresh-idempotent",
      idempotencyKey: "refresh-idempotent",
      now: "2026-07-19T10:00:00.000Z",
    });

    const first = await subject.register(command);
    const replay = await subject.register(command);

    expect(replay).toEqual(first);
    expect(await subject.listEndpointViews("house-1")).toEqual([
      expect.objectContaining({ endpointId: "endpoint-a", registrationVersion: 2 }),
    ]);
  });

  it("[T-PUSH-004][PUSH-003][DEC-020] 로그아웃은 현재 설치 endpoint만 삭제하고 다른 설치를 유지하며 반복 호출은 멱등 성공한다", async () => {
    const subject = createSubject({
      endpoints: [
        activeSeed(),
        activeSeed({ endpointId: "endpoint-b", fid: "FID-B", platform: "ios-pwa" }),
      ],
    });
    const command: RemoveEndpointCommand = {
      commandId: "logout-a",
      idempotencyKey: "logout-a",
      actor: actor("member-1"),
      fid: "FID-A",
    };

    expect(await subject.remove(command)).toEqual({ kind: "Removed", endpointId: "endpoint-a" });
    expect(await subject.listEndpointViews("house-1")).toEqual([
      expect.objectContaining({ endpointId: "endpoint-b", status: "active" }),
    ]);
    expect(
      await subject.remove({ ...command, commandId: "logout-a-again", idempotencyKey: "logout-a-again" }),
    ).toEqual({ kind: "AlreadyAbsent" });
  });

  it("[T-PUSH-004][PUSH-003/PUSH-008] 이전 로그아웃 삭제가 유실돼도 새 로그인은 같은 FID를 두 멤버에 남기지 않고 binding을 원자 교체한다", async () => {
    const subject = createSubject({ endpoints: [activeSeed()] });

    const result = await subject.register(
      registration({
        commandId: "new-login",
        idempotencyKey: "new-login",
        actor: actor("member-2"),
        now: "2026-07-19T11:00:00.000Z",
      }),
    );

    expect(result).toEqual({
      kind: "EndpointRegistered",
      endpointId: "endpoint-a",
      result: "stale-binding-recovered",
      registrationVersion: 2,
    });
    expect(await subject.listEndpointViews("house-1")).toEqual([
      expect.objectContaining({
        endpointId: "endpoint-a",
        memberId: "member-2",
        registrationVersion: 2,
        bindingVersion: 2,
        status: "active",
      }),
    ]);
  });

  it("[T-PUSH-004][PUSH-001][DEC-020] 데스크톱은 권한 요청·FID 등록 대상이 아니며 endpoint 상태를 만들지 않는다", async () => {
    const subject = createSubject();

    expect(
      subject.evaluateClientCapability({
        runtime: "desktop-web",
        osNotificationPermission: "granted",
      }),
    ).toEqual({ kind: "NotEligible", reason: "DESKTOP_NOT_SUPPORTED" });
    expect(await subject.listEndpointViews("house-1")).toEqual([]);
  });

  it.each([
    {
      runtime: "android-app" as const,
      permission: "denied" as const,
      expected: { kind: "Eligible", platform: "android" },
    },
    {
      runtime: "ios-home-screen-pwa" as const,
      permission: "granted" as const,
      expected: { kind: "Eligible", platform: "ios-pwa" },
    },
    {
      runtime: "ios-home-screen-pwa" as const,
      permission: "denied" as const,
      expected: { kind: "NotEligible", reason: "IOS_PERMISSION_REQUIRED" },
    },
  ])(
    "[T-PUSH-004][PUSH-001][DEC-026] $runtime / 권한 $permission 환경의 endpoint 등록 capability를 구분한다",
    ({ runtime, permission, expected }) => {
      expect(
        createSubject().evaluateClientCapability({
          runtime,
          osNotificationPermission: permission,
        }),
      ).toEqual(expected);
    },
  );

  it("[T-PUSH-004][PUSH-003/PUSH-008] 현재 version의 onUnregistered만 endpoint를 inactive로 전환한다", async () => {
    const subject = createSubject({ endpoints: [activeSeed()] });

    expect(
      await subject.markInactive({
        endpointId: "endpoint-a",
        expectedRegistrationVersion: 1,
        expectedBindingVersion: 1,
        now: "2026-07-19T12:00:00.000Z",
        observation: { source: "sdk-unregistered" },
      }),
    ).toEqual({ kind: "Inactivated" });
    expect(await subject.listEndpointViews("house-1")).toEqual([
      expect.objectContaining({
        endpointId: "endpoint-a",
        status: "inactive",
        inactiveAt: "2026-07-19T12:00:00.000Z",
        expiresAt: "2026-08-18T12:00:00.000Z",
      }),
    ]);
  });

  it("[T-PUSH-004/T-PUSH-006][PUSH-008] 404와 UNREGISTERED가 함께 있고 version이 현재일 때만 해당 endpoint를 inactive로 만든다", async () => {
    const subject = createSubject({
      endpoints: [
        activeSeed(),
        activeSeed({ endpointId: "endpoint-b", fid: "FID-B", registrationVersion: 2 }),
        activeSeed({ endpointId: "endpoint-c", fid: "FID-C" }),
      ],
    });

    const permanent = await subject.markInactive({
      endpointId: "endpoint-a",
      expectedRegistrationVersion: 1,
      expectedBindingVersion: 1,
      now: "2026-07-19T12:00:00.000Z",
      observation: { source: "provider", httpStatus: 404, code: "UNREGISTERED" },
    });
    const stale = await subject.markInactive({
      endpointId: "endpoint-b",
      expectedRegistrationVersion: 1,
      expectedBindingVersion: 1,
      now: "2026-07-19T12:00:00.000Z",
      observation: { source: "provider", httpStatus: 404, code: "UNREGISTERED" },
    });
    const nonPermanent = await subject.markInactive({
      endpointId: "endpoint-c",
      expectedRegistrationVersion: 1,
      expectedBindingVersion: 1,
      now: "2026-07-19T12:00:00.000Z",
      observation: { source: "provider", httpStatus: 404, code: "SENDER_ID_MISMATCH" },
    });

    expect(permanent).toEqual({ kind: "Inactivated" });
    expect(stale).toEqual({ kind: "StaleIgnored" });
    expect(nonPermanent).toEqual({ kind: "NotPermanentFailure" });
    expect(await subject.listEndpointViews("house-1")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ endpointId: "endpoint-a", status: "inactive" }),
        expect.objectContaining({ endpointId: "endpoint-b", status: "active", registrationVersion: 2 }),
        expect.objectContaining({ endpointId: "endpoint-c", status: "active" }),
      ]),
    );
  });
});

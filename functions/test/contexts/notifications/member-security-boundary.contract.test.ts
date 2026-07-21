import { describe, expect, it } from "vitest";
import type {
  HouseholdMemberRemovedEvent,
  NotificationsSecurityBoundaryInputPort,
  Principal,
  SecuredRegisterEndpointCommand,
  TerminalDeliveryView,
} from "../../../src/contexts/notifications/public";
import {
  createNotificationSecurityBoundaryFixtureSubject,
  type EndpointCommandSecurityTrace,
  type NotificationObservabilityRecord,
  type NotificationsSecurityFixture,
  type SecuredEndpointSeed,
} from "../../support/notification-security-boundary-driver";

export interface NotificationsSecurityBoundaryContractSubject
  extends NotificationsSecurityBoundaryInputPort {
  endpointCommandSecurityTrace(
    commandId: string,
  ): Promise<EndpointCommandSecurityTrace>;
  observabilityRecords(): Promise<readonly NotificationObservabilityRecord[]>;
  publishedPublicEvents(): Promise<readonly Readonly<Record<string, unknown>>[]>;
  legacyMigrationReport(): Promise<{
    scannedLegacyRecordCount: number;
    activeEndpointCount: number;
    plaintextAddressCount: 0;
  }>;
  /** Access 상태 전이를 재현하는 테스트 driver이며 Notifications의 공개 Command가 아닙니다. */
  setMembershipStatus(householdId: string, memberId: string, status: "active" | "removed"): void;
}

export function createSubject(
  fixture: NotificationsSecurityFixture,
): NotificationsSecurityBoundaryContractSubject {
  return createNotificationSecurityBoundaryFixtureSubject(fixture);
}

const principal = (memberId: string, householdId = "house-1"): Principal => ({
  uid: `uid-${memberId}`,
  householdId,
  memberId,
});

const endpoint = (
  endpointId: string,
  fid: string,
  memberId: string,
  householdId = "house-1",
): SecuredEndpointSeed => ({
  endpointId,
  fid,
  householdId,
  memberId,
  platform: "android",
  status: "active",
  registrationVersion: 1,
  bindingVersion: 1,
});

const registerCommand = (
  overrides: Partial<SecuredRegisterEndpointCommand> = {},
): SecuredRegisterEndpointCommand => ({
  commandId: "register-1",
  idempotencyKey: "register-1",
  principal: principal("member-1"),
  targetHouseholdId: "house-1",
  targetMemberId: "member-1",
  appAttestation: "valid",
  fid: "FID-SECRET-A",
  platform: "android",
  ...overrides,
});

const removedEvent = (
  overrides: Partial<HouseholdMemberRemovedEvent> = {},
): HouseholdMemberRemovedEvent => ({
  eventId: "member-removed-1",
  eventType: "HouseholdMemberRemoved.v1",
  producer: "access-household.membership",
  schemaVersion: 1,
  householdId: "house-1",
  memberId: "member-removed",
  systemCapability: "household-member-cleanup",
  ...overrides,
});

describe("Notifications 가구·멤버 보안 경계 공개 계약", () => {
  it.each([
    {
      name: "무인증",
      command: registerCommand({ principal: undefined }),
      expected: { kind: "Unauthenticated", code: "AUTH_REQUIRED" },
    },
    {
      name: "App Check 누락",
      command: registerCommand({ appAttestation: "missing" }),
      expected: { kind: "Forbidden", code: "APP_ATTESTATION_INVALID" },
    },
    {
      name: "App Check invalid",
      command: registerCommand({ appAttestation: "invalid" }),
      expected: { kind: "Forbidden", code: "APP_ATTESTATION_INVALID" },
    },
    {
      name: "타 가구",
      command: registerCommand({
        principal: principal("member-1", "house-2"),
        targetHouseholdId: "house-1",
      }),
      expected: { kind: "Forbidden", code: "MEMBERSHIP_REQUIRED" },
    },
    {
      name: "다른 멤버 사칭",
      command: registerCommand({ targetMemberId: "member-2" }),
      expected: { kind: "Forbidden", code: "MEMBERSHIP_REQUIRED" },
    },
    {
      name: "빈 FID",
      command: registerCommand({ fid: "" }),
      expected: { kind: "ValidationError", code: "FID_REQUIRED" },
    },
    {
      name: "빈 memberId",
      command: registerCommand({ targetMemberId: "" }),
      expected: { kind: "ValidationError", code: "MEMBER_ID_REQUIRED" },
    },
    {
      name: "지원하지 않는 platform",
      command: registerCommand({ platform: "desktop" }),
      expected: {
        kind: "ValidationError",
        code: "PLATFORM_NOT_SUPPORTED",
      },
    },
  ])(
    "[T-PUSH-SEC-001][PUSH-002/PUSH-009] $name endpoint 등록은 안정 오류와 변경 없음으로 끝난다",
    async ({ command, expected }) => {
      const existing = endpoint("endpoint-existing", "FID-EXISTING", "member-1");
      const subject = createSubject({
        memberships: { "house-1/member-1": "active", "house-1/member-2": "active" },
        endpoints: [existing],
      });

      expect(await subject.register(command)).toEqual(expected);
      expect(await subject.listEndpointViews("house-1")).toEqual([
        expect.objectContaining({ endpointId: "endpoint-existing", memberId: "member-1" }),
      ]);
      expect(
        await subject.endpointCommandSecurityTrace(command.commandId),
      ).toEqual({
        commandId: command.commandId,
        endpointRepositoryReadCount: 0,
        endpointRepositoryWriteCount: 0,
      });
    },
  );

  it("[T-PUSH-SEC-001][PUSH-009] removed Membership은 동일 Principal·가구·memberId를 제시해도 endpoint Repository 접근 전에 거부한다", async () => {
    const subject = createSubject({
      memberships: { "house-1/member-1": "removed" },
      endpoints: [endpoint("endpoint-existing", "FID-EXISTING", "member-1")],
    });
    const command = registerCommand({ commandId: "register-removed-member" });

    await expect(subject.register(command)).resolves.toEqual({
      kind: "Forbidden",
      code: "MEMBERSHIP_REQUIRED",
    });
    expect(await subject.endpointCommandSecurityTrace(command.commandId)).toEqual({
      commandId: command.commandId,
      endpointRepositoryReadCount: 0,
      endpointRepositoryWriteCount: 0,
    });
    expect(await subject.listEndpointViews("house-1")).toEqual([
      expect.objectContaining({ endpointId: "endpoint-existing" }),
    ]);
  });

  it("[T-PUSH-SEC-001][PUSH-002/PUSH-009] FID를 알아도 현재 binding의 인증된 멤버가 아니면 endpoint를 삭제할 수 없다", async () => {
    const subject = createSubject({
      memberships: { "house-1/member-1": "active", "house-1/member-2": "active" },
      endpoints: [endpoint("endpoint-a", "FID-SECRET-A", "member-1")],
    });

    expect(
      await subject.remove({
        principal: principal("member-2"),
        targetHouseholdId: "house-1",
        targetMemberId: "member-1",
        fid: "FID-SECRET-A",
      }),
    ).toEqual({ kind: "Forbidden", code: "MEMBERSHIP_REQUIRED" });
    expect(await subject.listEndpointViews("house-1")).toHaveLength(1);
  });

  it("[T-PUSH-SEC-001][PUSH-002/PUSH-009] 등록 결과와 공개 endpoint 조회에는 FID 원문이 노출되지 않는다", async () => {
    const subject = createSubject({ memberships: { "house-1/member-1": "active" } });

    const result = await subject.register(registerCommand());
    const views = await subject.listEndpointViews("house-1");

    expect(result.kind).toBe("EndpointRegistered");
    expect(JSON.stringify({ result, views })).not.toContain("FID-SECRET-A");
  });

  it("[T-PUSH-SEC-001][PUSH-002] 등록·삭제의 일반 로그와 공개 Event에는 raw FID나 FID hash를 남기지 않는다", async () => {
    const subject = createSubject({ memberships: { "house-1/member-1": "active" } });
    const secretFid = "FID-SECRET-DO-NOT-LOG";

    await subject.register(registerCommand({ fid: secretFid }));
    await subject.remove({
      principal: principal("member-1"),
      targetHouseholdId: "house-1",
      targetMemberId: "member-1",
      fid: secretFid,
    });

    const exposedObservability = JSON.stringify({
      logs: await subject.observabilityRecords(),
      events: await subject.publishedPublicEvents(),
      migrationReport: await subject.legacyMigrationReport(),
    });
    expect(exposedObservability).not.toContain(secretFid);
    expect(exposedObservability).not.toMatch(
      /"(?:fid|rawFid|fidHash|installationId)"/i,
    );
    expect(await subject.observabilityRecords()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "notification-endpoint-registration",
          endpointId: expect.any(String),
          resultCode: expect.any(String),
        }),
        expect.objectContaining({
          name: "notification-endpoint-removal",
          endpointId: expect.any(String),
          resultCode: expect.any(String),
        }),
      ]),
    );
    expect(await subject.legacyMigrationReport()).toEqual({
      scannedLegacyRecordCount: expect.any(Number),
      activeEndpointCount: expect.any(Number),
      plaintextAddressCount: 0,
    });
  });

  it("[T-PUSH-007][PUSH-012][DEC-038] 제거 Event는 대상 가구·멤버 endpoint만 정리하고 다른 멤버·타 가구·기존 terminal 기록을 유지한다", async () => {
    const terminal: TerminalDeliveryView = {
      deliveryId: "delivery-terminal",
      householdId: "house-1",
      recipientMemberId: "member-removed",
      endpointId: "removed-a",
      status: "delivered",
      providerAttemptCount: 1,
    };
    const subject = createSubject({
      memberships: {
        "house-1/member-removed": "removed",
        "house-1/member-other": "active",
        "house-2/member-removed": "active",
      },
      endpoints: [
        endpoint("removed-a", "FID-A", "member-removed"),
        endpoint("removed-b", "FID-B", "member-removed"),
        endpoint("other-c", "FID-C", "member-other"),
        endpoint("other-house-d", "FID-D", "member-removed", "house-2"),
      ],
      terminalDeliveries: [terminal],
    });

    expect(await subject.handleMemberRemoved(removedEvent())).toEqual({
      kind: "Completed",
      removedEndpointCount: 2,
    });
    expect(await subject.handleMemberRemoved(removedEvent())).toEqual({
      kind: "AlreadyProcessed",
      removedEndpointCount: 2,
    });
    expect(await subject.listEndpointViews("house-1")).toEqual([
      expect.objectContaining({ endpointId: "other-c", memberId: "member-other" }),
    ]);
    expect(await subject.listEndpointViews("house-2")).toEqual([
      expect.objectContaining({ endpointId: "other-house-d", memberId: "member-removed" }),
    ]);
    expect(await subject.listTerminalDeliveries("house-1")).toEqual([terminal]);
  });

  it("[T-PUSH-007][PUSH-012] 제거 Event cleanup 전이라도 recipient 계산과 delivery 직전 Membership 경계가 발송을 막는다", async () => {
    const subject = createSubject({
      memberships: {
        "house-1/member-requester": "active",
        "house-1/member-target": "active",
      },
      endpoints: [endpoint("target-a", "FID-TARGET", "member-target")],
    });
    const queued = await subject.acceptExplicitRequest({
      eventId: "explicit-before-removal",
      householdId: "house-1",
      requesterMemberId: "member-requester",
      transactionId: "expense-1",
    });
    expect(queued.kind).toBe("Queued");
    if (queued.kind !== "Queued") return;

    subject.setMembershipStatus("house-1", "member-target", "removed");
    expect(await subject.deliver(queued.deliveryIds[0])).toEqual({
      kind: "StaleTarget",
      code: "RECIPIENT_MEMBERSHIP_INACTIVE",
    });
    expect(await subject.listTerminalDeliveries("house-1")).toEqual([
      expect.objectContaining({
        recipientMemberId: "member-target",
        endpointId: "target-a",
        status: "stale-target",
        providerAttemptCount: 0,
      }),
    ]);

    const afterRemoval = await subject.acceptExplicitRequest({
      eventId: "explicit-after-removal",
      householdId: "house-1",
      requesterMemberId: "member-requester",
      transactionId: "expense-2",
    });
    expect(afterRemoval).toEqual({ kind: "NoTarget" });
  });

  it("[T-PUSH-007][PUSH-012][DEC-038] Membership 복구만으로 과거 endpoint가 되살아나지 않고 새 로그인 등록으로만 다시 연결된다", async () => {
    const subject = createSubject({
      memberships: { "house-1/member-removed": "removed" },
      endpoints: [endpoint("removed-a", "FID-A", "member-removed")],
    });
    await subject.handleMemberRemoved(removedEvent());

    subject.setMembershipStatus("house-1", "member-removed", "active");
    expect(await subject.listEndpointViews("house-1")).toEqual([]);

    expect(
      await subject.register(
        registerCommand({
          commandId: "login-after-restore",
          idempotencyKey: "login-after-restore",
          principal: principal("member-removed"),
          targetMemberId: "member-removed",
          fid: "FID-A",
        }),
      ),
    ).toMatchObject({ kind: "EndpointRegistered", result: "created" });
    expect(await subject.listEndpointViews("house-1")).toEqual([
      expect.objectContaining({ memberId: "member-removed", status: "active" }),
    ]);
  });

  it.each([
    {
      name: "알 수 없는 producer",
      event: removedEvent({ producer: "untrusted.producer" }),
      expected: { kind: "ContractFailure", code: "UNKNOWN_PRODUCER" },
    },
    {
      name: "지원하지 않는 schema version",
      event: removedEvent({ schemaVersion: 2 }),
      expected: { kind: "ContractFailure", code: "UNSUPPORTED_EVENT_VERSION" },
    },
    {
      name: "내부 capability 없음",
      event: removedEvent({ systemCapability: "invalid" }),
      expected: { kind: "Forbidden", code: "SYSTEM_CAPABILITY_REQUIRED" },
    },
  ])(
    "[T-PUSH-007/T-PUSH-SEC-001][PUSH-012] $name 제거 Event는 endpoint를 변경하지 않는다",
    async ({ event, expected }) => {
      const subject = createSubject({
        memberships: { "house-1/member-removed": "removed" },
        endpoints: [endpoint("removed-a", "FID-A", "member-removed")],
      });

      expect(await subject.handleMemberRemoved(event)).toEqual(expected);
      expect(await subject.listEndpointViews("house-1")).toHaveLength(1);
    },
  );

  it("[T-PUSH-SEC-001][PUSH-009] 타 가구 delivery 조회는 존재 여부와 관계없이 같은 Forbidden 결과다", async () => {
    const terminal: TerminalDeliveryView = {
      deliveryId: "delivery-secret",
      householdId: "house-1",
      recipientMemberId: "member-1",
      endpointId: "endpoint-a",
      status: "delivered",
      providerAttemptCount: 1,
    };
    const subject = createSubject({
      memberships: { "house-1/member-1": "active", "house-2/member-2": "active" },
      terminalDeliveries: [terminal],
    });
    const outsider = principal("member-2", "house-2");

    expect(
      await subject.getDeliveryStatus({
        principal: outsider,
        householdId: "house-1",
        deliveryId: "delivery-secret",
      }),
    ).toEqual({ kind: "Forbidden", code: "HOUSEHOLD_ACCESS_DENIED" });
    expect(
      await subject.getDeliveryStatus({
        principal: outsider,
        householdId: "house-1",
        deliveryId: "delivery-does-not-exist",
      }),
    ).toEqual({ kind: "Forbidden", code: "HOUSEHOLD_ACCESS_DENIED" });
  });
});

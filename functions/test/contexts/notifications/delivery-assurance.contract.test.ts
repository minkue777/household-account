import { describe, expect, it } from "vitest";
import type {
  AcceptNotificationIntentResult as PublicAcceptNotificationIntentResult,
  DeliverNotificationResult as PublicDeliverNotificationResult,
  DeliveryAssuranceInputPort,
  DeliveryItemView as PublicDeliveryItemView,
  DeliveryStatusView as PublicDeliveryStatusView,
  HouseholdNotificationRequestedEvent as PublicHouseholdNotificationRequestedEvent,
  NotificationInboxStatusView as PublicNotificationInboxStatusView,
  PublicEndpointStatusView as PublishedEndpointStatusView,
} from "../../../src/contexts/notifications/public";
import {
  createDeliveryAssuranceFixtureSubject,
  type DeliveryEndpointSeed as FixtureDeliveryEndpointSeed,
  type DeliverySeed as FixtureDeliverySeed,
  type ProviderOutcome as FixtureProviderOutcome,
  type ProviderSendCallView as FixtureProviderSendCallView,
} from "../../support/delivery-assurance-driver";

export type DeliveryEndpointSeed = FixtureDeliveryEndpointSeed;

export type DeliverySeed = FixtureDeliverySeed;

export type ProviderOutcome = FixtureProviderOutcome;

export type HouseholdNotificationRequestedEvent =
  PublicHouseholdNotificationRequestedEvent;

export type AcceptNotificationIntentResult =
  PublicAcceptNotificationIntentResult;

export type DeliverNotificationResult =
  PublicDeliverNotificationResult;

export type DeliveryItemView = PublicDeliveryItemView;

export type DeliveryStatusView = PublicDeliveryStatusView;

export type PublicEndpointStatusView = PublishedEndpointStatusView;

export type ProviderSendCallView = FixtureProviderSendCallView;

export type NotificationInboxStatusView = PublicNotificationInboxStatusView;

export interface DeliveryAssuranceContractSubject
  extends DeliveryAssuranceInputPort {
  providerSendCalls(): Promise<readonly ProviderSendCallView[]>;
}

export function createSubject(_fixture: {
  now: string;
  endpoints: readonly DeliveryEndpointSeed[];
  memberships: Readonly<Record<string, "active" | "removed" | "unavailable">>;
  deliveries?: readonly DeliverySeed[];
  providerOutcomeByEndpointId?: Readonly<Record<string, ProviderOutcome>>;
  inboxEventIds?: readonly string[];
  /** provider 결과와 최종 상태 commit이 경합하는 상황을 만드는 테스트 driver입니다. */
  endpointChangeBeforeResultCommit?: Readonly<
    Record<string, { registrationVersion: number; bindingVersion: number }>
  >;
}): DeliveryAssuranceContractSubject {
  return createDeliveryAssuranceFixtureSubject(_fixture);
}

const endpoint = (
  endpointId: string,
  memberId: string,
  overrides: Partial<DeliveryEndpointSeed> = {},
): DeliveryEndpointSeed => ({
  endpointId,
  fid: `FID-${endpointId}`,
  householdId: "house-1",
  memberId,
  platform: "android",
  status: "active",
  registrationVersion: 1,
  bindingVersion: 1,
  ...overrides,
});

const delivery = (
  deliveryId: string,
  recipientMemberId: string,
  endpointId = deliveryId.replace("delivery", "endpoint"),
  overrides: Partial<DeliverySeed> = {},
): DeliverySeed => ({
  deliveryId,
  intentId: "intent-1",
  eventId: "event-1",
  householdId: "house-1",
  recipientMemberId,
  endpointId,
  expectedRegistrationVersion: 1,
  expectedBindingVersion: 1,
  status: "queued",
  ...overrides,
});

const explicitEvent = (
  overrides: Partial<HouseholdNotificationRequestedEvent> = {},
): HouseholdNotificationRequestedEvent => ({
  eventId: "event-explicit-1",
  eventType: "HouseholdNotificationRequested.v1",
  producer: "household-finance.ledger",
  occurredAt: "2026-07-19T08:59:00.000Z",
  householdId: "house-1",
  transactionId: "expense-1",
  requesterMemberId: "member-requester",
  ...overrides,
});

describe("알림 Delivery 멱등성과 결과 분류 공개 계약", () => {
  it("[T-PUSH-003][PUSH-010][DEC-025] 같은 Event와 delivery를 재실행해도 endpoint별 terminal 결과와 provider 전송 시도는 한 번만 기록된다", async () => {
    const subject = createSubject({
      now: "2026-07-19T09:00:00.000Z",
      endpoints: [endpoint("endpoint-recipient", "member-recipient")],
      memberships: { "member-requester": "active", "member-recipient": "active" },
      providerOutcomeByEndpointId: { "endpoint-recipient": { kind: "success" } },
    });
    const event = explicitEvent();

    const firstAccept = await subject.accept(event);
    const replayAccept = await subject.accept(event);

    expect(firstAccept).toMatchObject({ kind: "Queued" });
    expect(replayAccept).toEqual({
      kind: "AlreadyProcessed",
      intentId: firstAccept.kind === "Queued" ? firstAccept.intentId : "",
      deliveryIds: firstAccept.kind === "Queued" ? firstAccept.deliveryIds : [],
    });
    if (firstAccept.kind !== "Queued") return;

    const deliveryId = firstAccept.deliveryIds[0];
    const concurrentResults = await Promise.all([
      subject.deliver(deliveryId),
      subject.deliver(deliveryId),
    ]);
    const replayResult = await subject.deliver(deliveryId);
    await subject.completeIntent(firstAccept.intentId);
    await subject.completeIntent(firstAccept.intentId);

    expect(concurrentResults).toEqual([
      { kind: "Delivered" },
      { kind: "Delivered" },
    ]);
    expect(replayResult).toEqual({ kind: "Delivered" });
    expect(await subject.providerSendCalls()).toEqual([
      {
        deliveryId,
        endpointId: "endpoint-recipient",
        fid: "FID-endpoint-recipient",
        payload: {
          payloadVersion: "notification-payload.v1",
          type: "household-notification-requested",
          clickTarget: "expense-edit",
          expenseId: "expense-1",
        },
        operation: "sendOne",
      },
    ]);
    expect(JSON.stringify(await subject.providerSendCalls())).not.toMatch(
      /"(?:fids|token|tokens)"/,
    );
    await expect(subject.getInboxStatus(event.eventId)).resolves.toEqual({
      eventId: event.eventId,
      status: "terminal",
      terminalAt: "2026-07-19T09:00:00.000Z",
      expiresAt: "2026-08-18T09:00:00.000Z",
    });

    expect(await subject.getDeliveryStatus(firstAccept.intentId)).toEqual({
      intentId: firstAccept.intentId,
      status: "delivered",
      deliveries: [
        expect.objectContaining({
          deliveryId,
          recipientMemberId: "member-recipient",
          endpointId: "endpoint-recipient",
          status: "delivered",
          providerAttemptCount: 1,
          terminalAt: "2026-07-19T09:00:00.000Z",
          expiresAt: "2026-08-18T09:00:00.000Z",
        }),
      ],
    });
    await expect(
      subject.getTerminalRetentionDisposition(
        deliveryId,
        "2026-08-17T09:00:00.000Z",
      ),
    ).resolves.toBe("retain");
    await expect(
      subject.getTerminalRetentionDisposition(
        deliveryId,
        "2026-08-18T09:00:00.000Z",
      ),
    ).resolves.toBe("eligible-for-ttl-deletion");
  });

  it("[T-PUSH-006][PUSH-008/PUSH-010][DEC-025] endpoint별 성공·영구·계약·일반·결과불명을 따로 보존하고 혼합 결과를 partial로 집계한다", async () => {
    const deliveryIds = [
      "delivery-a",
      "delivery-b",
      "delivery-c",
      "delivery-d",
      "delivery-e",
      "delivery-f",
      "delivery-g",
      "delivery-h",
    ] as const;
    const subject = createSubject({
      now: "2026-07-19T09:00:00.000Z",
      endpoints: [
        endpoint("endpoint-a", "member-a"),
        endpoint("endpoint-b", "member-b"),
        endpoint("endpoint-c", "member-c"),
        endpoint("endpoint-d", "member-d"),
        endpoint("endpoint-e", "member-e"),
        endpoint("endpoint-f", "member-f"),
        endpoint("endpoint-g", "member-g"),
        endpoint("endpoint-h", "member-h"),
      ],
      memberships: {
        "member-a": "active",
        "member-b": "active",
        "member-c": "active",
        "member-d": "active",
        "member-e": "active",
        "member-f": "active",
        "member-g": "active",
        "member-h": "active",
      },
      deliveries: [
        delivery("delivery-a", "member-a"),
        delivery("delivery-b", "member-b"),
        delivery("delivery-c", "member-c"),
        delivery("delivery-d", "member-d"),
        delivery("delivery-e", "member-e"),
        delivery("delivery-f", "member-f"),
        delivery("delivery-g", "member-g"),
        delivery("delivery-h", "member-h"),
      ],
      providerOutcomeByEndpointId: {
        "endpoint-a": { kind: "success" },
        "endpoint-b": { kind: "http-error", httpStatus: 404, code: "UNREGISTERED" },
        "endpoint-c": { kind: "http-error", httpStatus: 404, code: "SENDER_ID_MISMATCH" },
        "endpoint-d": { kind: "http-error", httpStatus: 500, code: "INTERNAL" },
        "endpoint-e": { kind: "timeout" },
        "endpoint-f": { kind: "quota" },
        "endpoint-g": { kind: "network-error" },
        "endpoint-h": { kind: "credential-error" },
      },
    });

    const results = await Promise.all(deliveryIds.map((deliveryId) => subject.deliver(deliveryId)));

    expect(results).toEqual([
      { kind: "Delivered" },
      { kind: "PermanentFailure", code: "FID_UNREGISTERED" },
      { kind: "ContractFailure", code: "PROVIDER_RESPONSE_INVALID" },
      { kind: "Failed", code: "PROVIDER_HTTP_ERROR" },
      { kind: "UnknownProviderOutcome", code: "PROVIDER_TIMEOUT" },
      { kind: "Failed", code: "PROVIDER_QUOTA" },
      { kind: "Failed", code: "PROVIDER_NETWORK_ERROR" },
      { kind: "ContractFailure", code: "PROVIDER_CREDENTIAL_INVALID" },
    ]);
    const status = await subject.getDeliveryStatus("intent-1");
    expect(status?.status).toBe("partial");
    expect(status?.deliveries.map((item) => [item.endpointId, item.status, item.providerAttemptCount])).toEqual([
      ["endpoint-a", "delivered", 1],
      ["endpoint-b", "permanent-failure", 1],
      ["endpoint-c", "contract-failure", 1],
      ["endpoint-d", "failed", 1],
      ["endpoint-e", "unknown-provider-outcome", 1],
      ["endpoint-f", "failed", 1],
      ["endpoint-g", "failed", 1],
      ["endpoint-h", "contract-failure", 1],
    ]);
    expect(await subject.listEndpointStatuses("house-1")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ endpointId: "endpoint-a", status: "active" }),
        expect.objectContaining({ endpointId: "endpoint-b", status: "inactive" }),
        expect.objectContaining({ endpointId: "endpoint-c", status: "active" }),
        expect.objectContaining({ endpointId: "endpoint-d", status: "active" }),
        expect.objectContaining({ endpointId: "endpoint-e", status: "active" }),
        expect.objectContaining({ endpointId: "endpoint-f", status: "active" }),
        expect.objectContaining({ endpointId: "endpoint-g", status: "active" }),
        expect.objectContaining({ endpointId: "endpoint-h", status: "active" }),
      ]),
    );

    const replayedResults = await Promise.all(
      deliveryIds.map((deliveryId) => subject.deliver(deliveryId)),
    );
    expect(replayedResults).toEqual(results);
    const providerCalls = await subject.providerSendCalls();
    expect(providerCalls).toHaveLength(deliveryIds.length);
    expect(
      deliveryIds.every(
        (deliveryId) =>
          providerCalls.filter((call) => call.deliveryId === deliveryId)
            .length === 1,
      ),
    ).toBe(true);
  });

  it("[T-PUSH-006][PUSH-008][DEC-020] 전송 뒤 같은 endpoint가 재등록되면 stale UNREGISTERED 결과가 최신 endpoint를 비활성화하지 않는다", async () => {
    const subject = createSubject({
      now: "2026-07-19T09:00:00.000Z",
      endpoints: [endpoint("endpoint-b", "member-b")],
      memberships: { "member-b": "active" },
      deliveries: [delivery("delivery-b", "member-b")],
      providerOutcomeByEndpointId: {
        "endpoint-b": { kind: "http-error", httpStatus: 404, code: "UNREGISTERED" },
      },
      endpointChangeBeforeResultCommit: {
        "delivery-b": { registrationVersion: 2, bindingVersion: 1 },
      },
    });

    expect(await subject.deliver("delivery-b")).toEqual({
      kind: "PermanentFailure",
      code: "FID_UNREGISTERED",
    });
    expect(await subject.listEndpointStatuses("house-1")).toEqual([
      {
        endpointId: "endpoint-b",
        status: "active",
        registrationVersion: 2,
        bindingVersion: 1,
      },
    ]);
    expect(await subject.providerSendCalls()).toEqual([
      {
        deliveryId: "delivery-b",
        endpointId: "endpoint-b",
        fid: "FID-endpoint-b",
        payload: {
          payloadVersion: "notification-payload.v1",
          type: "household-notification-requested",
          clickTarget: "expense-edit",
          expenseId: "expense-1",
        },
        operation: "sendOne",
      },
    ]);
  });

  it.each([
    {
      name: "endpoint version 변경",
      endpointSeed: endpoint("endpoint-a", "member-a", { registrationVersion: 2 }),
      memberships: { "member-a": "active" as const },
      expected: { kind: "StaleTarget", code: "ENDPOINT_CHANGED" },
    },
    {
      name: "recipient Membership 제거",
      endpointSeed: endpoint("endpoint-a", "member-a"),
      memberships: { "member-a": "removed" as const },
      expected: { kind: "StaleTarget", code: "RECIPIENT_MEMBERSHIP_INACTIVE" },
    },
  ])(
    "[T-PUSH-007][PUSH-012] $name 상태는 provider 전달 없이 stale-target terminal 결과로 끝난다",
    async ({ endpointSeed, memberships, expected }) => {
      const subject = createSubject({
        now: "2026-07-19T09:00:00.000Z",
        endpoints: [endpointSeed],
        memberships,
        deliveries: [delivery("delivery-a", "member-a")],
        providerOutcomeByEndpointId: { "endpoint-a": { kind: "success" } },
      });

      expect(await subject.deliver("delivery-a")).toEqual(expected);
      expect(await subject.getDeliveryStatus("intent-1")).toEqual({
        intentId: "intent-1",
        status: "stale-target",
        deliveries: [
          expect.objectContaining({
            deliveryId: "delivery-a",
            status: "stale-target",
            providerAttemptCount: 0,
          }),
        ],
      });
      expect(await subject.providerSendCalls()).toEqual([]);
    },
  );

  it("[T-PUSH-005/T-PUSH-003][PUSH-005/PUSH-010] 대상 endpoint가 없으면 조회 가능한 no-target intent를 남기고 provider를 호출하지 않는다", async () => {
    const subject = createSubject({
      now: "2026-07-19T09:00:00.000Z",
      endpoints: [endpoint("endpoint-requester", "member-requester")],
      memberships: { "member-requester": "active" },
    });

    const accepted = await subject.accept(explicitEvent({ eventId: "event-no-target" }));

    expect(accepted).toEqual({
      kind: "NoTarget",
      intentId: expect.any(String),
    });
    if (accepted.kind !== "NoTarget") return;
    expect(await subject.getDeliveryStatus(accepted.intentId)).toEqual({
      intentId: accepted.intentId,
      status: "no-target",
      deliveries: [],
    });
    await expect(subject.getInboxStatus("event-no-target")).resolves.toEqual({
      eventId: "event-no-target",
      status: "terminal",
      code: "NO_TARGET",
      terminalAt: "2026-07-19T09:00:00.000Z",
      expiresAt: "2026-08-18T09:00:00.000Z",
    });
    expect(await subject.providerSendCalls()).toEqual([]);
  });

  const aggregateStatusCases = [
    {
      name: "모든 endpoint 일반 실패",
      outcome: { kind: "quota" },
      result: { kind: "Failed", code: "PROVIDER_QUOTA" },
      aggregateStatus: "failed",
    },
    {
      name: "provider 결과 불명",
      outcome: { kind: "timeout" },
      result: { kind: "UnknownProviderOutcome", code: "PROVIDER_TIMEOUT" },
      aggregateStatus: "unknown-provider-outcome",
    },
    {
      name: "영구 FID 실패",
      outcome: { kind: "http-error", httpStatus: 404, code: "UNREGISTERED" },
      result: { kind: "PermanentFailure", code: "FID_UNREGISTERED" },
      aggregateStatus: "permanent-failure",
    },
    {
      name: "provider 자격 계약 실패",
      outcome: { kind: "credential-error" },
      result: { kind: "ContractFailure", code: "PROVIDER_CREDENTIAL_INVALID" },
      aggregateStatus: "contract-failure",
    },
  ] satisfies readonly {
    name: string;
    outcome: ProviderOutcome;
    result: DeliverNotificationResult;
    aggregateStatus: DeliveryStatusView["status"];
  }[];

  it.each(aggregateStatusCases)(
    "[T-PUSH-006][PUSH-008/PUSH-010] $name은 partial로 축약하지 않고 고유 aggregate 상태를 보존한다",
    async ({ outcome, result, aggregateStatus }) => {
      const subject = createSubject({
        now: "2026-07-19T09:00:00.000Z",
        endpoints: [endpoint("endpoint-only", "member-only")],
        memberships: { "member-only": "active" },
        deliveries: [
          delivery("delivery-only", "member-only", "endpoint-only"),
        ],
        providerOutcomeByEndpointId: { "endpoint-only": outcome },
      });

      await expect(subject.deliver("delivery-only")).resolves.toEqual(result);
      expect((await subject.getDeliveryStatus("intent-1"))?.status).toBe(
        aggregateStatus,
      );
      expect(await subject.providerSendCalls()).toHaveLength(1);
    },
  );

  it("[T-PUSH-003/T-PUSH-006][PUSH-010] intent 계산 전 Membership 조회 실패는 Inbox를 retryable로 남기고 delivery·provider 호출을 만들지 않는다", async () => {
    const subject = createSubject({
      now: "2026-07-19T09:00:00.000Z",
      endpoints: [endpoint("endpoint-recipient", "member-recipient")],
      memberships: {
        "member-requester": "active",
        "member-recipient": "unavailable",
      },
    });
    const event = explicitEvent({ eventId: "event-membership-unavailable" });

    await expect(subject.accept(event)).resolves.toEqual({
      kind: "RetryableFailure",
      code: "MEMBERSHIP_LOOKUP_UNAVAILABLE",
    });
    expect(await subject.getInboxStatus(event.eventId)).toEqual({
      eventId: event.eventId,
      status: "retryable",
      code: "MEMBERSHIP_LOOKUP_UNAVAILABLE",
    });
    expect(await subject.listDeliveryStatuses("house-1")).toEqual([]);
    expect(await subject.providerSendCalls()).toEqual([]);
  });

  it("[T-PUSH-006/T-PUSH-007][PUSH-010/PUSH-012] provider 직전 Membership 조회 실패는 최종 failed·시도 0건으로 fail-closed한다", async () => {
    const subject = createSubject({
      now: "2026-07-19T09:00:00.000Z",
      endpoints: [endpoint("endpoint-a", "member-a")],
      memberships: { "member-a": "unavailable" },
      deliveries: [delivery("delivery-a", "member-a")],
      providerOutcomeByEndpointId: { "endpoint-a": { kind: "success" } },
    });

    await expect(subject.deliver("delivery-a")).resolves.toEqual({
      kind: "Failed",
      code: "MEMBERSHIP_CHECK_UNAVAILABLE",
    });
    expect(await subject.getDeliveryStatus("intent-1")).toEqual({
      intentId: "intent-1",
      status: "failed",
      deliveries: [
        expect.objectContaining({
          deliveryId: "delivery-a",
          status: "failed",
          providerAttemptCount: 0,
          errorCode: "MEMBERSHIP_CHECK_UNAVAILABLE",
        }),
      ],
    });
    expect(await subject.providerSendCalls()).toEqual([]);
  });

  it.each([
    { name: "없어도", inboxEventIds: [] as readonly string[] },
    { name: "있어도", inboxEventIds: ["event-too-old"] as readonly string[] },
  ])(
    "[T-PUSH-003][PUSH-010][DEC-027] 30일보다 오래된 Event는 Inbox 기록이 $name 새 delivery를 만들지 않는다",
    async ({ inboxEventIds }) => {
    const subject = createSubject({
      now: "2026-07-19T09:00:00.000Z",
      endpoints: [endpoint("endpoint-recipient", "member-recipient")],
      memberships: { "member-requester": "active", "member-recipient": "active" },
      inboxEventIds,
    });

    const result = await subject.accept(
      explicitEvent({
        eventId: "event-too-old",
        occurredAt: "2026-06-18T09:00:00.000Z",
      }),
    );

    expect(result).toEqual({ kind: "ExpiredEvent" });
    expect(await subject.listDeliveryStatuses("house-1")).toEqual([]);
    expect(await subject.providerSendCalls()).toEqual([]);
    },
  );

  it("[T-PUSH-003][PUSH-010][DEC-027] 정확히 30일 된 Event는 아직 expired가 아니며 그보다 1ms 오래된 Event만 거부한다", async () => {
    const subject = createSubject({
      now: "2026-07-19T09:00:00.000Z",
      endpoints: [endpoint("endpoint-recipient", "member-recipient")],
      memberships: { "member-requester": "active", "member-recipient": "active" },
    });

    await expect(
      subject.accept(
        explicitEvent({
          eventId: "event-exactly-30-days",
          occurredAt: "2026-06-19T09:00:00.000Z",
        }),
      ),
    ).resolves.toMatchObject({ kind: "Queued" });
    await expect(
      subject.accept(
        explicitEvent({
          eventId: "event-older-than-30-days",
          occurredAt: "2026-06-19T08:59:59.999Z",
        }),
      ),
    ).resolves.toEqual({ kind: "ExpiredEvent" });
  });
});

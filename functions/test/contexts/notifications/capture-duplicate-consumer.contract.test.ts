import { describe, expect, it } from "vitest";
import type {
  AcceptDuplicateNotificationResult as PublicAcceptDuplicateNotificationResult,
  CaptureDuplicateNotificationInputPort,
  CaptureDuplicateObservedEvent as PublicCaptureDuplicateObservedEvent,
  DeliverDuplicateNotificationResult as PublicDeliverDuplicateNotificationResult,
} from "../../../src/contexts/notifications/public";
import {
  createCaptureDuplicateConsumerFixtureSubject,
  type CaptureDuplicateNotificationSnapshot as FixtureCaptureDuplicateNotificationSnapshot,
  type DuplicateNotificationEndpoint as FixtureDuplicateNotificationEndpoint,
} from "../../support/capture-duplicate-consumer-driver";

export type CaptureDuplicateObservedEvent = PublicCaptureDuplicateObservedEvent;

export type DuplicateNotificationEndpoint = FixtureDuplicateNotificationEndpoint;

export type AcceptDuplicateNotificationResult =
  PublicAcceptDuplicateNotificationResult;

export type DeliverDuplicateNotificationResult =
  PublicDeliverDuplicateNotificationResult;

export type CaptureDuplicateNotificationSnapshot =
  FixtureCaptureDuplicateNotificationSnapshot;

/**
 * Payment Capture가 발행한 duplicate Event를 소비하는 Notifications 전용 경계입니다.
 * producer의 거래/receipt 쓰기와 endpoint·provider 처리를 한 Subject에 결합하지 않습니다.
 */
export interface CaptureDuplicateConsumerContractSubject
  extends CaptureDuplicateNotificationInputPort {
  providerSendCalls(): Promise<
    readonly {
      deliveryId: string;
      endpointId: string;
      fid: string;
      operation: "sendOne";
    }[]
  >;
  snapshot(): Promise<CaptureDuplicateNotificationSnapshot>;
}

export function createSubject(_fixture: {
  endpoints: readonly DuplicateNotificationEndpoint[];
  sourceLedgerDigest: string;
  deliveryOutcomeByEndpointId?: Readonly<
    Record<
      string,
      "delivered" | "failed" | "unknown-provider-outcome" | "permanent-failure"
    >
  >;
}): CaptureDuplicateConsumerContractSubject {
  return createCaptureDuplicateConsumerFixtureSubject(_fixture);
}

const event = (
  overrides: Partial<CaptureDuplicateObservedEvent> = {},
): CaptureDuplicateObservedEvent => ({
  eventId: "capture-duplicate-event-1",
  eventType: "CaptureDuplicateObserved.v1",
  schemaVersion: 1,
  producer: "payment-capture.intake",
  householdId: "house-1",
  existingTransactionId: "transaction-existing",
  recipientMemberId: "member-creator",
  occurredAt: "2026-07-19T09:00:00.000Z",
  ...overrides,
});

const endpoints: readonly DuplicateNotificationEndpoint[] = [
  {
    endpointId: "creator-ios-a",
    householdId: "house-1",
    memberId: "member-creator",
    platform: "ios-pwa",
    status: "active",
    fid: "FID-CREATOR-A",
  },
  {
    endpointId: "creator-android",
    householdId: "house-1",
    memberId: "member-creator",
    platform: "android",
    status: "active",
    fid: "FID-CREATOR-ANDROID",
  },
  {
    endpointId: "other-ios",
    householdId: "house-1",
    memberId: "member-other",
    platform: "ios-pwa",
    status: "active",
    fid: "FID-OTHER",
  },
  {
    endpointId: "creator-other-house",
    householdId: "house-2",
    memberId: "member-creator",
    platform: "ios-pwa",
    status: "active",
    fid: "FID-OTHER-HOUSE",
  },
];

describe("Capture duplicate Notifications consumer 공개 계약", () => {
  it("[T-IOS-NOTIFY-002][IOS-009/PUSH-008] duplicate Event는 기존 거래를 가리키는 생성자 active iPhone delivery만 만들고 새 거래를 만들지 않는다", async () => {
    const subject = createSubject({
      endpoints,
      sourceLedgerDigest: "ledger-before-duplicate-notification",
    });

    const accepted = await subject.accept(event());

    expect(accepted).toEqual({
      kind: "Queued",
      intentId: expect.any(String),
      deliveryIds: [expect.any(String)],
    });
    const state = await subject.snapshot();
    expect(state.createdTransactionIds).toEqual([]);
    expect(state.sourceLedgerDigest).toBe("ledger-before-duplicate-notification");
    expect(state.intents).toEqual([
      expect.objectContaining({
        eventId: "capture-duplicate-event-1",
        transactionId: "transaction-existing",
        recipientMemberId: "member-creator",
        status: "queued",
      }),
    ]);
    expect(state.deliveries).toEqual([
      expect.objectContaining({ endpointId: "creator-ios-a", status: "queued" }),
    ]);
  });

  it.each([
    ["delivered", { kind: "Delivered" }],
    ["failed", { kind: "Failed" }],
    ["unknown-provider-outcome", { kind: "UnknownProviderOutcome" }],
    ["permanent-failure", { kind: "PermanentFailure" }],
  ] as const)(
    "[T-IOS-NOTIFY-002][IOS-009/PUSH-010] provider %s 결과는 기존 거래를 바꾸지 않고 delivery 최종 상태로만 남는다",
    async (outcome, expected) => {
      const subject = createSubject({
        endpoints: [endpoints[0]],
        sourceLedgerDigest: "committed-ledger-state",
        deliveryOutcomeByEndpointId: { "creator-ios-a": outcome },
      });
      const accepted = await subject.accept(
        event({ eventId: `duplicate-${outcome}` }),
      );
      if (accepted.kind !== "Queued") {
        throw new Error("테스트 준비용 duplicate delivery가 생성되지 않았습니다.");
      }

      await expect(
        subject.deliver(accepted.deliveryIds[0]),
      ).resolves.toEqual(expected);
      expect((await subject.snapshot()).sourceLedgerDigest).toBe(
        "committed-ledger-state",
      );
      expect((await subject.snapshot()).createdTransactionIds).toEqual([]);
      expect((await subject.snapshot()).deliveries).toEqual([
        expect.objectContaining({
          endpointId: "creator-ios-a",
          status: outcome,
        }),
      ]);
      expect(await subject.providerSendCalls()).toHaveLength(1);
    },
  );

  it("[T-IOS-NOTIFY-002][IOS-009/PUSH-010] 같은 duplicate Event와 delivery의 동시·순차 재실행도 provider sendOne을 한 번만 호출한다", async () => {
    const subject = createSubject({
      endpoints: [endpoints[0]],
      sourceLedgerDigest: "committed-ledger-state",
      deliveryOutcomeByEndpointId: { "creator-ios-a": "delivered" },
    });
    const first = await subject.accept(event());
    const replay = await subject.accept(event());
    expect(first.kind).toBe("Queued");
    expect(replay).toEqual(
      expect.objectContaining({ kind: "AlreadyProcessed" }),
    );
    if (first.kind !== "Queued") return;

    const [a, b] = await Promise.all([
      subject.deliver(first.deliveryIds[0]),
      subject.deliver(first.deliveryIds[0]),
    ]);
    const sequentialReplay = await subject.deliver(first.deliveryIds[0]);

    expect([a, b, sequentialReplay]).toEqual([
      { kind: "Delivered" },
      { kind: "Delivered" },
      { kind: "Delivered" },
    ]);
    expect(await subject.providerSendCalls()).toEqual([
      {
        deliveryId: first.deliveryIds[0],
        endpointId: "creator-ios-a",
        fid: "FID-CREATOR-A",
        operation: "sendOne",
      },
    ]);
  });

  it("[T-IOS-NOTIFY-002][IOS-009] 생성자의 active iPhone endpoint가 없으면 조회 가능한 NoTarget만 만들고 provider를 호출하지 않는다", async () => {
    const subject = createSubject({
      endpoints: endpoints.slice(1),
      sourceLedgerDigest: "committed-ledger-state",
    });

    await expect(subject.accept(event())).resolves.toEqual({
      kind: "NoTarget",
      intentId: expect.any(String),
    });
    expect((await subject.snapshot()).deliveries).toEqual([]);
    expect(await subject.providerSendCalls()).toEqual([]);
  });

  it.each([
    {
      name: "알 수 없는 producer",
      invalidEvent: event({ producer: "untrusted.producer" }),
      code: "UNKNOWN_PRODUCER" as const,
    },
    {
      name: "지원하지 않는 schema version",
      invalidEvent: event({ schemaVersion: 2 }),
      code: "UNSUPPORTED_EVENT_VERSION" as const,
    },
  ])(
    "[T-IOS-NOTIFY-002][IOS-009] $name Event는 Inbox·Intent·Delivery를 만들지 않는다",
    async ({ invalidEvent, code }) => {
      const subject = createSubject({
        endpoints,
        sourceLedgerDigest: "committed-ledger-state",
      });

      await expect(subject.accept(invalidEvent)).resolves.toEqual({
        kind: "ContractFailure",
        code,
      });
      expect(await subject.snapshot()).toEqual({
        inboxEventIds: [],
        intents: [],
        deliveries: [],
        createdTransactionIds: [],
        sourceLedgerDigest: "committed-ledger-state",
      });
      expect(await subject.providerSendCalls()).toEqual([]);
    },
  );
});

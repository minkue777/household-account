import { describe, expect, it } from "vitest";
import type {
  ShortcutTransactionNotificationInputPort,
  ShortcutTransactionNotificationResult as PublicShortcutTransactionNotificationResult,
  ShortcutTransactionRecordedEvent as PublicShortcutTransactionRecordedEvent,
} from "../../../src/contexts/notifications/public";
import {
  createShortcutTransactionConsumerFixtureSubject,
  type ShortcutCreatorEndpoint,
  type ShortcutTransactionNotificationSnapshot as FixtureShortcutTransactionNotificationSnapshot,
} from "../../support/shortcut-transaction-consumer-driver";

export type ShortcutTransactionRecordedEvent =
  PublicShortcutTransactionRecordedEvent;

export type ShortcutTransactionNotificationResult =
  PublicShortcutTransactionNotificationResult;

export type ShortcutTransactionNotificationSnapshot =
  FixtureShortcutTransactionNotificationSnapshot;

/** Shortcut TransactionRecorded Event의 Notifications consumer 경계입니다. */
export interface ShortcutTransactionConsumerContractSubject
  extends ShortcutTransactionNotificationInputPort {
  providerSendCalls(): readonly {
    eventId: string;
    endpointId: string;
    fid: string;
    operation: "sendOne";
  }[];
  snapshot(): ShortcutTransactionNotificationSnapshot;
}

export function createSubject(_fixture: {
  sourceLedgerDigest: string;
  creatorEndpoint?: ShortcutCreatorEndpoint;
  providerOutcome:
    | "delivered"
    | "failed"
    | "unknown-provider-outcome"
    | "permanent-failure"
    | "contract-failure";
}): ShortcutTransactionConsumerContractSubject {
  return createShortcutTransactionConsumerFixtureSubject(_fixture);
}

const event: ShortcutTransactionRecordedEvent = {
  eventId: "shortcut-transaction-recorded-1",
  eventType: "TransactionRecorded.v1",
  producer: "payment-capture.shortcut-ingestion",
  householdId: "house-1",
  transactionId: "transaction-1",
  creatorMemberId: "member-creator",
  originChannel: "ios-shortcut",
};

describe("Shortcut TransactionRecorded Notifications consumer 공개 계약", () => {
  it.each([
    ["delivered", "Delivered"],
    ["failed", "Failed"],
    ["unknown-provider-outcome", "UnknownProviderOutcome"],
    ["permanent-failure", "PermanentFailure"],
    ["contract-failure", "ContractFailure"],
  ] as const)(
    "[T-IOS-NOTIFY-001][IOS-008/PUSH-004/PUSH-010] provider %s 결과와 무관하게 commit된 Shortcut 거래를 유지한다",
    async (providerOutcome, expectedKind) => {
      const subject = createSubject({
        sourceLedgerDigest: "ledger-with-transaction-1",
        creatorEndpoint: {
          endpointId: "creator-ios",
          householdId: "house-1",
          memberId: "member-creator",
          platform: "ios-pwa",
          status: "active",
          fid: "FID-CREATOR-IOS",
        },
        providerOutcome,
      });

      await expect(subject.consume(event)).resolves.toEqual({
        kind: expectedKind,
        transactionId: "transaction-1",
      });
      expect(subject.snapshot().sourceLedgerDigest).toBe(
        "ledger-with-transaction-1",
      );
      expect(subject.snapshot().inboxEventIds).toEqual([
        "shortcut-transaction-recorded-1",
      ]);
      expect(subject.snapshot().deliveries).toEqual([
        {
          eventId: "shortcut-transaction-recorded-1",
          endpointId: "creator-ios",
          status: providerOutcome,
        },
      ]);
      expect(subject.providerSendCalls()).toEqual([
        {
          eventId: "shortcut-transaction-recorded-1",
          endpointId: "creator-ios",
          fid: "FID-CREATOR-IOS",
          payload: {
            payloadVersion: "notification-payload.v1",
            type: "expense-created",
            clickTarget: "expense-edit",
            expenseId: "transaction-1",
          },
          operation: "sendOne",
        },
      ]);
    },
  );

  it("[T-IOS-NOTIFY-001][IOS-008/PUSH-004] 생성자의 활성 iPhone endpoint가 없으면 재시도 실패가 아니라 NoTarget으로 종료한다", async () => {
    const subject = createSubject({
      sourceLedgerDigest: "ledger-with-transaction-1",
      providerOutcome: "delivered",
    });

    await expect(subject.consume(event)).resolves.toEqual({
      kind: "NoTarget",
      transactionId: "transaction-1",
      reason: "NO_ACTIVE_ENDPOINT",
    });
    expect(subject.snapshot()).toEqual({
      sourceLedgerDigest: "ledger-with-transaction-1",
      inboxEventIds: [],
      deliveries: [],
    });
    expect(subject.providerSendCalls()).toEqual([]);
  });

  it("[T-IOS-NOTIFY-001/T-PUSH-011][IOS-008/PUSH-004/PUSH-014] 생성자가 푸시 수신 제외 상태이면 활성 iPhone endpoint에도 보내지 않는다", async () => {
    const subject = createSubject({
      sourceLedgerDigest: "ledger-with-transaction-1",
      creatorEndpoint: {
        endpointId: "creator-ios",
        householdId: "house-1",
        memberId: "member-creator",
        platform: "ios-pwa",
        status: "active",
        fid: "FID-CREATOR-IOS",
        pushDelivery: "disabled",
      },
      providerOutcome: "delivered",
    });

    await expect(subject.consume(event)).resolves.toEqual({
      kind: "NoTarget",
      transactionId: "transaction-1",
      reason: "NO_ACTIVE_ENDPOINT",
    });
    expect(subject.providerSendCalls()).toEqual([]);
  });
});

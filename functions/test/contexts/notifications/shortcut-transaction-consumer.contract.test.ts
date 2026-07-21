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
  creatorEndpoint: ShortcutCreatorEndpoint;
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
          operation: "sendOne",
        },
      ]);
    },
  );
});

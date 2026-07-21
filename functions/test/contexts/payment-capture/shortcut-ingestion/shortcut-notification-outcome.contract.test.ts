import { describe, expect, it } from "vitest";
import { createShortcutNotificationOutcomeDriver } from "../../../support/shortcut-notification-outcome-driver";

export type ShortcutCommittedSourceEvent =
  | {
      eventId: string;
      eventName: "TransactionRecorded.v1";
      producer: "household-finance.ledger";
      householdId: string;
      transactionId: string;
      creatorMemberId: string;
      originChannel: "ios-shortcut";
    }
  | {
      eventId: string;
      eventName: "CaptureDuplicateObserved.v1";
      producer: "payment-capture.intake";
      householdId: string;
      transactionId: string;
      creatorMemberId: string;
      originChannel: "ios-shortcut";
    };

export type ConsumeShortcutOutcomeResult =
  | {
      kind: "created-recorded";
      transactionId: string;
      eventId: string;
    }
  | {
      kind: "duplicate-observed";
      existingTransactionId: string;
      eventId: string;
    }
  | { kind: "already-processed"; eventId: string }
  | { kind: "source-event-not-found"; sourceEventId: string };

export interface ShortcutNotificationConsumerSnapshot {
  sourceEvents: readonly ShortcutCommittedSourceEvent[];
  consumedSourceEventIds: readonly string[];
  generatedTransactionIds: readonly string[];
  generatedOutboxEvents: readonly unknown[];
}

/**
 * Shortcut은 source event를 새로 발행하지 않습니다. Ledger/Payment Intake가 이미
 * 원자 commit한 event를 소비하고 HTTP 응답용 receipt만 멱등 기록합니다.
 */
export interface ShortcutNotificationOutcomeContractSubject {
  consumeOutcome(input: {
    requestKey: string;
    sourceEventId: string;
  }): Promise<ConsumeShortcutOutcomeResult>;
  snapshot(): ShortcutNotificationConsumerSnapshot;
}

export function createSubject(fixture: {
  sourceEvents: readonly ShortcutCommittedSourceEvent[];
}): ShortcutNotificationOutcomeContractSubject {
  return createShortcutNotificationOutcomeDriver(fixture);
}

const createdSourceEvent: ShortcutCommittedSourceEvent = {
  eventId: "ledger-event-created",
  eventName: "TransactionRecorded.v1",
  producer: "household-finance.ledger",
  householdId: "household-1",
  transactionId: "transaction-1",
  creatorMemberId: "member-creator",
  originChannel: "ios-shortcut",
};

const duplicateSourceEvent: ShortcutCommittedSourceEvent = {
  eventId: "intake-event-duplicate",
  eventName: "CaptureDuplicateObserved.v1",
  producer: "payment-capture.intake",
  householdId: "household-1",
  transactionId: "transaction-existing",
  creatorMemberId: "member-creator",
  originChannel: "ios-shortcut",
};

describe("Shortcut source event 결과 소비·응답 receipt 공개 계약", () => {
  it("[T-IOS-NOTIFY-001][IOS-008] Created는 Ledger가 commit한 TransactionRecorded source event를 소비할 뿐 새 거래·Outbox를 만들지 않는다", async () => {
    const subject = createSubject({ sourceEvents: [createdSourceEvent] });

    expect(
      await subject.consumeOutcome({
        requestKey: "request-created",
        sourceEventId: createdSourceEvent.eventId,
      }),
    ).toEqual({
      kind: "created-recorded",
      transactionId: "transaction-1",
      eventId: "ledger-event-created",
    });
    expect(subject.snapshot()).toEqual({
      sourceEvents: [createdSourceEvent],
      consumedSourceEventIds: ["ledger-event-created"],
      generatedTransactionIds: [],
      generatedOutboxEvents: [],
    });
  });

  it("[T-IOS-NOTIFY-002][IOS-009] Duplicate는 Payment Intake가 commit한 관찰 source event를 소비하며 새 거래를 합성하지 않는다", async () => {
    const subject = createSubject({ sourceEvents: [duplicateSourceEvent] });

    expect(
      await subject.consumeOutcome({
        requestKey: "request-duplicate",
        sourceEventId: duplicateSourceEvent.eventId,
      }),
    ).toEqual({
      kind: "duplicate-observed",
      existingTransactionId: "transaction-existing",
      eventId: "intake-event-duplicate",
    });
    expect(subject.snapshot()).toEqual({
      sourceEvents: [duplicateSourceEvent],
      consumedSourceEventIds: ["intake-event-duplicate"],
      generatedTransactionIds: [],
      generatedOutboxEvents: [],
    });
  });

  it.each([
    ["created", createdSourceEvent],
    ["duplicate", duplicateSourceEvent],
  ] as const)(
    "[T-IOS-NOTIFY-001/T-IOS-NOTIFY-002][IOS-008/IOS-009] 같은 %s source event 재소비는 응답 receipt만 재생한다",
    async (name, sourceEvent) => {
      const subject = createSubject({ sourceEvents: [sourceEvent] });
      const input = {
        requestKey: `request-replay-${name}`,
        sourceEventId: sourceEvent.eventId,
      };

      const first = await subject.consumeOutcome(input);
      const replay = await subject.consumeOutcome(input);

      expect(first.kind).not.toBe("already-processed");
      expect(replay).toEqual({
        kind: "already-processed",
        eventId: sourceEvent.eventId,
      });
      expect(subject.snapshot().consumedSourceEventIds).toEqual([
        sourceEvent.eventId,
      ]);
      expect(subject.snapshot().generatedOutboxEvents).toEqual([]);
    },
  );

  it("[T-IOS-NOTIFY-001][IOS-011] 같은 source event의 동시 소비도 receipt 하나로 수렴한다", async () => {
    const subject = createSubject({ sourceEvents: [createdSourceEvent] });
    const input = {
      requestKey: "request-concurrent",
      sourceEventId: createdSourceEvent.eventId,
    };

    const results = await Promise.all([
      subject.consumeOutcome(input),
      subject.consumeOutcome(input),
    ]);

    expect(results).toEqual([
      {
        kind: "created-recorded",
        transactionId: "transaction-1",
        eventId: "ledger-event-created",
      },
      { kind: "already-processed", eventId: "ledger-event-created" },
    ]);
    expect(subject.snapshot().consumedSourceEventIds).toHaveLength(1);
  });

  it("[T-IOS-NOTIFY-001][T-IOS-NOTIFY-002][IOS-011] 같은 requestKey가 다른 source event로 재사용되면 최초 receipt를 보존한다", async () => {
    const subject = createSubject({
      sourceEvents: [createdSourceEvent, duplicateSourceEvent],
    });
    await subject.consumeOutcome({
      requestKey: "request-conflict",
      sourceEventId: createdSourceEvent.eventId,
    });

    expect(
      await subject.consumeOutcome({
        requestKey: "request-conflict",
        sourceEventId: duplicateSourceEvent.eventId,
      }),
    ).toEqual({
      kind: "already-processed",
      eventId: createdSourceEvent.eventId,
    });
    expect(subject.snapshot().consumedSourceEventIds).toEqual([
      createdSourceEvent.eventId,
    ]);
  });

  it("[T-IOS-NOTIFY-001][IOS-011] 같은 source event를 다른 requestKey로 받아도 다시 소비하지 않는다", async () => {
    const subject = createSubject({ sourceEvents: [createdSourceEvent] });
    await subject.consumeOutcome({
      requestKey: "request-a",
      sourceEventId: createdSourceEvent.eventId,
    });

    expect(
      await subject.consumeOutcome({
        requestKey: "request-b",
        sourceEventId: createdSourceEvent.eventId,
      }),
    ).toEqual({
      kind: "already-processed",
      eventId: createdSourceEvent.eventId,
    });
    expect(subject.snapshot().consumedSourceEventIds).toHaveLength(1);
  });

  it("[T-IOS-NOTIFY-001][T-IOS-NOTIFY-002] commit되지 않은 source event ID는 소비하거나 새 Event로 보완하지 않는다", async () => {
    const subject = createSubject({ sourceEvents: [] });

    expect(
      await subject.consumeOutcome({
        requestKey: "request-missing",
        sourceEventId: "event-not-committed",
      }),
    ).toEqual({
      kind: "source-event-not-found",
      sourceEventId: "event-not-committed",
    });
    expect(subject.snapshot()).toEqual({
      sourceEvents: [],
      consumedSourceEventIds: [],
      generatedTransactionIds: [],
      generatedOutboxEvents: [],
    });
  });

  it("[T-IOS-NOTIFY-001][IOS-008] snapshot 반환값 변경은 source event와 소비 receipt에 영향을 주지 않는다", async () => {
    const subject = createSubject({ sourceEvents: [createdSourceEvent] });
    await subject.consumeOutcome({
      requestKey: "request-isolation",
      sourceEventId: createdSourceEvent.eventId,
    });
    const snapshot = subject.snapshot();

    (snapshot.sourceEvents as ShortcutCommittedSourceEvent[])[0].creatorMemberId =
      "member-mutated";
    (snapshot.consumedSourceEventIds as string[]).push("event-mutated");

    expect(subject.snapshot()).toMatchObject({
      sourceEvents: [{ creatorMemberId: "member-creator" }],
      consumedSourceEventIds: [createdSourceEvent.eventId],
      generatedTransactionIds: [],
      generatedOutboxEvents: [],
    });
  });
});

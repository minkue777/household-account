import { describe, expect, it } from "vitest";
import { createShortcutOutboxResponseDriver } from "../../../support/shortcut-outbox-response-driver";

type ShortcutLedgerResult =
  | { kind: "Created"; transactionId: string; creatorMemberId: string }
  | { kind: "Duplicate"; existingTransactionId: string; creatorMemberId: string }
  | { kind: "Rejected"; code: string };

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

export interface ShortcutPaymentResultV2 {
  contractVersion: "shortcut-payment-response.v2";
  commandId: string;
  transaction:
    | { kind: "created"; transactionId: string }
    | { kind: "duplicate"; existingTransactionId: string }
    | { kind: "rejected"; code: string };
  notification: {
    state:
      | "queued"
      | "delivered"
      | "no-target"
      | "failed"
      | "unknown-provider-outcome"
      | "permanent-failure"
      | "not-requested";
    targetMemberId?: string;
    deliveryId?: string;
  };
}

export interface LegacyShortcutPaymentResponse {
  success: boolean;
  duplicate: boolean;
  notificationSent: boolean;
  targetOwner: string | null;
}

interface ShortcutOutboxState {
  sourceEvents: readonly ShortcutCommittedSourceEvent[];
  consumedSourceEventIds: readonly string[];
  generatedOutboxEvents: readonly unknown[];
  generatedTransactionIds: readonly string[];
  domainResults: readonly ShortcutPaymentResultV2[];
  legacyPayloadsAtDomainBoundary: readonly unknown[];
}

export interface ShortcutOutboxResponseCompatibilitySubject {
  publish(input: {
    commandId: string;
    ledgerResult: ShortcutLedgerResult;
    sourceEventId?: string;
  }): ShortcutPaymentResultV2;
  mapLegacyOutbound(result: ShortcutPaymentResultV2): LegacyShortcutPaymentResponse;
  state(): ShortcutOutboxState;
}

export function createSubject(fixture: {
  sourceEvents?: readonly ShortcutCommittedSourceEvent[];
} = {}): ShortcutOutboxResponseCompatibilitySubject {
  return createShortcutOutboxResponseDriver(fixture);
}

const createdSourceEvent: ShortcutCommittedSourceEvent = {
  eventId: "ledger-event-created",
  eventName: "TransactionRecorded.v1",
  producer: "household-finance.ledger",
  householdId: "household-a",
  transactionId: "expense-a",
  creatorMemberId: "member-a",
  originChannel: "ios-shortcut",
};

const duplicateSourceEvent: ShortcutCommittedSourceEvent = {
  eventId: "intake-event-duplicate",
  eventName: "CaptureDuplicateObserved.v1",
  producer: "payment-capture.intake",
  householdId: "household-a",
  transactionId: "expense-existing",
  creatorMemberId: "member-a",
  originChannel: "ios-shortcut",
};

describe("Shortcut source receipt·typed v2·legacy outbound mapper 공개 계약", () => {
  it("[T-IOS-NOTIFY-001][IOS-008] Created는 Ledger source event receipt를 응답으로 매핑하고 새 Outbox를 만들지 않는다", () => {
    const subject = createSubject({ sourceEvents: [createdSourceEvent] });

    expect(
      subject.publish({
        commandId: "shortcut-command-a",
        sourceEventId: createdSourceEvent.eventId,
        ledgerResult: {
          kind: "Created",
          transactionId: "expense-a",
          creatorMemberId: "member-a",
        },
      }),
    ).toEqual({
      contractVersion: "shortcut-payment-response.v2",
      commandId: "shortcut-command-a",
      transaction: { kind: "created", transactionId: "expense-a" },
      notification: { state: "queued", targetMemberId: "member-a" },
    });
    expect(subject.state()).toMatchObject({
      sourceEvents: [createdSourceEvent],
      consumedSourceEventIds: [createdSourceEvent.eventId],
      generatedOutboxEvents: [],
      generatedTransactionIds: [],
    });
  });

  it("[T-IOS-NOTIFY-002][IOS-009] Duplicate는 Payment Intake source event receipt만 매핑하고 새 거래를 합성하지 않는다", () => {
    const subject = createSubject({ sourceEvents: [duplicateSourceEvent] });

    expect(
      subject.publish({
        commandId: "shortcut-command-duplicate",
        sourceEventId: duplicateSourceEvent.eventId,
        ledgerResult: {
          kind: "Duplicate",
          existingTransactionId: "expense-existing",
          creatorMemberId: "member-a",
        },
      }),
    ).toMatchObject({
      transaction: {
        kind: "duplicate",
        existingTransactionId: "expense-existing",
      },
      notification: { state: "queued", targetMemberId: "member-a" },
    });
    expect(subject.state()).toMatchObject({
      sourceEvents: [duplicateSourceEvent],
      consumedSourceEventIds: [duplicateSourceEvent.eventId],
      generatedOutboxEvents: [],
      generatedTransactionIds: [],
    });
  });

  it("[T-IOS-NOTIFY-001][T-IOS-NOTIFY-002][IOS-011] 같은 command 재실행은 typed result만 재생하고 source receipt를 중복 기록하지 않는다", () => {
    const subject = createSubject({ sourceEvents: [createdSourceEvent] });
    const input = {
      commandId: "shortcut-command-replay",
      sourceEventId: createdSourceEvent.eventId,
      ledgerResult: {
        kind: "Created" as const,
        transactionId: "expense-a",
        creatorMemberId: "member-a",
      },
    };

    const first = subject.publish(input);
    expect(subject.publish(input)).toEqual(first);
    expect(subject.state().consumedSourceEventIds).toEqual([
      createdSourceEvent.eventId,
    ]);
    expect(subject.state().domainResults).toHaveLength(1);
  });

  it("[T-IOS-002][IOS-007][IOS-008] Ledger 거부 결과는 source event 없이 transaction·notification 결과를 분리한다", () => {
    const subject = createSubject();

    expect(
      subject.publish({
        commandId: "shortcut-command-rejected",
        ledgerResult: { kind: "Rejected", code: "CARD_NOT_OWNED" },
      }),
    ).toEqual({
      contractVersion: "shortcut-payment-response.v2",
      commandId: "shortcut-command-rejected",
      transaction: { kind: "rejected", code: "CARD_NOT_OWNED" },
      notification: { state: "not-requested" },
    });
    expect(subject.state().consumedSourceEventIds).toEqual([]);
    expect(subject.state().generatedOutboxEvents).toEqual([]);
  });

  it.each([
    ["queued", false],
    ["delivered", true],
    ["no-target", false],
    ["failed", false],
    ["unknown-provider-outcome", false],
    ["permanent-failure", false],
  ] as const)(
    "[T-IOS-COMPAT-001][IOS-008][IOS-009] 호환 창의 outbound mapper만 %s를 legacy notificationSent=%s로 변환한다",
    (state, notificationSent) => {
      const subject = createSubject();
      const typed: ShortcutPaymentResultV2 = {
        contractVersion: "shortcut-payment-response.v2",
        commandId: `command-${state}`,
        transaction: { kind: "created", transactionId: "expense-a" },
        notification: {
          state,
          targetMemberId: "member-a",
          ...(state === "delivered" ? { deliveryId: "delivery-a" } : {}),
        },
      };

      expect(subject.mapLegacyOutbound(typed)).toEqual({
        success: true,
        duplicate: false,
        notificationSent,
        targetOwner: "member-a",
      });
      expect(subject.state().legacyPayloadsAtDomainBoundary).toEqual([]);
    },
  );

  it("[T-IOS-COMPAT-001][IOS-009] Duplicate typed 결과의 legacy 변환도 거래 identity를 바꾸지 않는다", () => {
    const subject = createSubject();
    const typed: ShortcutPaymentResultV2 = {
      contractVersion: "shortcut-payment-response.v2",
      commandId: "command-duplicate",
      transaction: {
        kind: "duplicate",
        existingTransactionId: "expense-existing",
      },
      notification: { state: "no-target", targetMemberId: "member-a" },
    };

    expect(subject.mapLegacyOutbound(typed)).toEqual({
      success: true,
      duplicate: true,
      notificationSent: false,
      targetOwner: "member-a",
    });
    expect(typed.transaction).toEqual({
      kind: "duplicate",
      existingTransactionId: "expense-existing",
    });
  });

  it("[T-IOS-COMPAT-001][IOS-009] rejected typed 결과는 legacy 성공이나 알림 성공으로 표현하지 않는다", () => {
    const subject = createSubject();
    const typed: ShortcutPaymentResultV2 = {
      contractVersion: "shortcut-payment-response.v2",
      commandId: "command-rejected-legacy",
      transaction: { kind: "rejected", code: "CARD_NOT_OWNED" },
      notification: { state: "not-requested" },
    };

    expect(subject.mapLegacyOutbound(typed)).toEqual({
      success: false,
      duplicate: false,
      notificationSent: false,
      targetOwner: null,
    });
    expect(subject.state().legacyPayloadsAtDomainBoundary).toEqual([]);
  });

  it("[T-IOS-COMPAT-001][IOS-008] not-requested 상태도 실제 전송 성공으로 위장하지 않는다", () => {
    const subject = createSubject();

    expect(
      subject.mapLegacyOutbound({
        contractVersion: "shortcut-payment-response.v2",
        commandId: "command-not-requested",
        transaction: { kind: "created", transactionId: "expense-a" },
        notification: { state: "not-requested" },
      }),
    ).toEqual({
      success: true,
      duplicate: false,
      notificationSent: false,
      targetOwner: null,
    });
  });

  it("[T-IOS-NOTIFY-001][T-IOS-NOTIFY-002][IOS-011] 같은 commandId에 다른 source가 재전송되어도 최초 response receipt를 보존한다", () => {
    const subject = createSubject({
      sourceEvents: [createdSourceEvent, duplicateSourceEvent],
    });
    const first = subject.publish({
      commandId: "shortcut-command-conflicting-replay",
      sourceEventId: createdSourceEvent.eventId,
      ledgerResult: {
        kind: "Created",
        transactionId: "expense-a",
        creatorMemberId: "member-a",
      },
    });

    const replay = subject.publish({
      commandId: "shortcut-command-conflicting-replay",
      sourceEventId: duplicateSourceEvent.eventId,
      ledgerResult: {
        kind: "Duplicate",
        existingTransactionId: "expense-existing",
        creatorMemberId: "member-a",
      },
    });

    expect(replay).toEqual(first);
    expect(subject.state().consumedSourceEventIds).toEqual([
      createdSourceEvent.eventId,
    ]);
    expect(subject.state().domainResults).toEqual([first]);
  });

  it("[T-IOS-NOTIFY-001][IOS-008] 반환값을 변경해도 저장된 response receipt와 source event는 변하지 않는다", () => {
    const subject = createSubject({ sourceEvents: [createdSourceEvent] });
    const result = subject.publish({
      commandId: "shortcut-command-snapshot-isolation",
      sourceEventId: createdSourceEvent.eventId,
      ledgerResult: {
        kind: "Created",
        transactionId: "expense-a",
        creatorMemberId: "member-a",
      },
    });

    result.notification.state = "delivered";
    result.notification.targetMemberId = "member-mutated";

    expect(subject.state()).toMatchObject({
      sourceEvents: [{ creatorMemberId: "member-a" }],
      domainResults: [
        {
          notification: { state: "queued", targetMemberId: "member-a" },
        },
      ],
      generatedOutboxEvents: [],
      generatedTransactionIds: [],
    });
  });

  it("[T-IOS-NOTIFY-001][T-IOS-NOTIFY-002] source event가 아직 commit되지 않았으면 응답 receipt나 대체 Outbox를 만들지 않는다", () => {
    const subject = createSubject();

    expect(
      subject.publish({
        commandId: "command-source-missing",
        sourceEventId: "missing-source",
        ledgerResult: {
          kind: "Created",
          transactionId: "expense-a",
          creatorMemberId: "member-a",
        },
      }),
    ).toMatchObject({
      transaction: { kind: "rejected", code: "SOURCE_EVENT_NOT_FOUND" },
      notification: { state: "not-requested" },
    });
    expect(subject.state().domainResults).toEqual([]);
    expect(subject.state().generatedOutboxEvents).toEqual([]);
  });

  it("[T-IOS-NOTIFY-001][T-IOS-NOTIFY-002] source event의 종류·거래·creator가 Ledger 결과와 다르면 소비하지 않는다", () => {
    const subject = createSubject({ sourceEvents: [duplicateSourceEvent] });

    expect(
      subject.publish({
        commandId: "command-source-mismatch",
        sourceEventId: duplicateSourceEvent.eventId,
        ledgerResult: {
          kind: "Created",
          transactionId: "expense-a",
          creatorMemberId: "member-a",
        },
      }),
    ).toMatchObject({
      transaction: { kind: "rejected", code: "SOURCE_EVENT_MISMATCH" },
      notification: { state: "not-requested" },
    });
    expect(subject.state().consumedSourceEventIds).toEqual([]);
    expect(subject.state().domainResults).toEqual([]);
  });
});

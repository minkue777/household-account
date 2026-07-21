import type { ShortcutCommittedSourceEvent } from "../model/shortcutCommittedSourceEvent";
import type {
  ShortcutLedgerResult,
  ShortcutPaymentResultV2,
} from "../model/shortcutOutboxResponse";

export type ShortcutOutboxResponseDecision =
  | {
      readonly kind: "mapped";
      readonly result: ShortcutPaymentResultV2;
      readonly consumedSourceEventId?: string;
    }
  | {
      readonly kind: "source-event-mismatch";
      readonly result: ShortcutPaymentResultV2;
    };

function rejectedResult(
  commandId: string,
  code: string,
): ShortcutPaymentResultV2 {
  return {
    contractVersion: "shortcut-payment-response.v2",
    commandId,
    transaction: { kind: "rejected", code },
    notification: { state: "not-requested" },
  };
}

export function sourceEventNotFoundResult(
  commandId: string,
): ShortcutPaymentResultV2 {
  return rejectedResult(commandId, "SOURCE_EVENT_NOT_FOUND");
}

export function buildShortcutOutboxResponse(input: {
  readonly commandId: string;
  readonly ledgerResult: ShortcutLedgerResult;
  readonly sourceEvent?: ShortcutCommittedSourceEvent;
}): ShortcutOutboxResponseDecision {
  const { commandId, ledgerResult, sourceEvent } = input;
  if (ledgerResult.kind === "Rejected") {
    return {
      kind: "mapped",
      result: rejectedResult(commandId, ledgerResult.code),
    };
  }

  const expectedTransactionId =
    ledgerResult.kind === "Created"
      ? ledgerResult.transactionId
      : ledgerResult.existingTransactionId;
  const expectedEventName =
    ledgerResult.kind === "Created"
      ? "TransactionRecorded.v1"
      : "CaptureDuplicateObserved.v1";
  if (
    sourceEvent === undefined ||
    sourceEvent.eventName !== expectedEventName ||
    sourceEvent.transactionId !== expectedTransactionId ||
    sourceEvent.creatorMemberId !== ledgerResult.creatorMemberId ||
    sourceEvent.originChannel !== "ios-shortcut"
  ) {
    return {
      kind: "source-event-mismatch",
      result: rejectedResult(commandId, "SOURCE_EVENT_MISMATCH"),
    };
  }

  return {
    kind: "mapped",
    consumedSourceEventId: sourceEvent.eventId,
    result: {
      contractVersion: "shortcut-payment-response.v2",
      commandId,
      transaction:
        ledgerResult.kind === "Created"
          ? { kind: "created", transactionId: expectedTransactionId }
          : {
              kind: "duplicate",
              existingTransactionId: expectedTransactionId,
            },
      notification: {
        state: "queued",
        targetMemberId: ledgerResult.creatorMemberId,
      },
    },
  };
}

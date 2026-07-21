import type { ShortcutCommittedSourceEvent } from "../model/shortcutCommittedSourceEvent";
import type { ShortcutNotificationOutcomeCommit } from "../model/shortcutNotificationOutcome";

export function buildShortcutNotificationOutcome(input: {
  readonly requestKey: string;
  readonly sourceEvent: ShortcutCommittedSourceEvent;
}): ShortcutNotificationOutcomeCommit {
  const { requestKey, sourceEvent } = input;
  return {
    requestKey,
    sourceEventId: sourceEvent.eventId,
    result:
      sourceEvent.eventName === "TransactionRecorded.v1"
        ? {
            kind: "created-recorded",
            transactionId: sourceEvent.transactionId,
            eventId: sourceEvent.eventId,
          }
        : {
            kind: "duplicate-observed",
            existingTransactionId: sourceEvent.transactionId,
            eventId: sourceEvent.eventId,
          },
  };
}

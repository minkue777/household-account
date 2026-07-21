import type { ShortcutNotificationOutcomeInputPort } from "./ports/in/shortcutNotificationOutcomeInputPort";
import type {
  ShortcutNotificationOutcomeReceiptStorePort,
} from "./ports/out/shortcutNotificationOutcomeStorePort";
import type { ShortcutCommittedSourceEventQueryPort } from "./ports/out/shortcutCommittedSourceEventQueryPort";
import { buildShortcutNotificationOutcome } from "../domain/policies/buildShortcutNotificationOutcome";

export function createShortcutNotificationOutcomeApplication(dependencies: {
  readonly sourceEvents: ShortcutCommittedSourceEventQueryPort;
  readonly receipts: ShortcutNotificationOutcomeReceiptStorePort;
}): ShortcutNotificationOutcomeInputPort {
  return {
    async consumeOutcome(input) {
      const sourceEvent = dependencies.sourceEvents.findById(
        input.sourceEventId,
      );
      if (sourceEvent === undefined) {
        return {
          kind: "source-event-not-found",
          sourceEventId: input.sourceEventId,
        };
      }

      const receipt = buildShortcutNotificationOutcome({
        requestKey: input.requestKey,
        sourceEvent,
      });
      const consumed = await dependencies.receipts.consumeOnce(receipt);
      return consumed.kind === "already-consumed"
        ? {
            kind: "already-processed",
            eventId: consumed.sourceEventId,
          }
        : receipt.result;
    },
  };
}

import type { ShortcutOutboxResponseInputPort } from "./ports/in/shortcutOutboxResponseInputPort";
import type { ShortcutCommittedSourceEventQueryPort } from "./ports/out/shortcutCommittedSourceEventQueryPort";
import type { ShortcutOutboxResponseStorePort } from "./ports/out/shortcutOutboxResponseStorePort";
import {
  buildShortcutOutboxResponse,
  sourceEventNotFoundResult,
} from "../domain/policies/buildShortcutOutboxResponse";

export function createShortcutOutboxResponseApplication(dependencies: {
  readonly store: ShortcutOutboxResponseStorePort;
  readonly sourceEvents: ShortcutCommittedSourceEventQueryPort;
}): ShortcutOutboxResponseInputPort {
  return {
    publish(input) {
      const replay = dependencies.store.findByCommandId(input.commandId);
      if (replay !== undefined) return replay;

      const requiresSourceEvent = input.ledgerResult.kind !== "Rejected";
      const sourceEvent =
        input.sourceEventId === undefined
          ? undefined
          : dependencies.sourceEvents.findById(input.sourceEventId);
      if (requiresSourceEvent && sourceEvent === undefined) {
        return sourceEventNotFoundResult(input.commandId);
      }

      const decision = buildShortcutOutboxResponse({
        commandId: input.commandId,
        ledgerResult: input.ledgerResult,
        ...(sourceEvent === undefined ? {} : { sourceEvent }),
      });
      if (decision.kind === "source-event-mismatch") return decision.result;

      const committed = dependencies.store.commitOnce({
        commandId: input.commandId,
        result: decision.result,
        ...(decision.consumedSourceEventId === undefined
          ? {}
          : { consumedSourceEventId: decision.consumedSourceEventId }),
      });
      return committed.kind === "AlreadyCommitted"
        ? committed.result
        : decision.result;
    },
  };
}

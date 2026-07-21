import type { PublishShortcutNotificationOutcomeResult } from "../../../domain/model/shortcutNotificationOutcome";

export interface ShortcutNotificationOutcomeInputPort {
  consumeOutcome(input: {
    readonly requestKey: string;
    readonly sourceEventId: string;
  }): Promise<PublishShortcutNotificationOutcomeResult>;
}

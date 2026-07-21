import type { ShortcutNotificationOutcomeCommit } from "../../../domain/model/shortcutNotificationOutcome";

export type ShortcutNotificationOutcomeCommitResult =
  | { readonly kind: "consumed" }
  | { readonly kind: "already-consumed"; readonly sourceEventId: string };

export interface ShortcutNotificationOutcomeReceiptStorePort {
  consumeOnce(
    receipt: ShortcutNotificationOutcomeCommit,
  ): Promise<ShortcutNotificationOutcomeCommitResult>;
}

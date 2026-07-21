export type PublishShortcutNotificationOutcomeResult =
  | {
      readonly kind: "created-recorded";
      readonly transactionId: string;
      readonly eventId: string;
    }
  | {
      readonly kind: "duplicate-observed";
      readonly existingTransactionId: string;
      readonly eventId: string;
    }
  | { readonly kind: "already-processed"; readonly eventId: string }
  | { readonly kind: "source-event-not-found"; readonly sourceEventId: string };

/**
 * Transaction/Outbox 커밋이 아니라 이미 커밋된 원천 이벤트를 소비한 Inbox receipt입니다.
 */
export interface ShortcutNotificationOutcomeCommit {
  readonly requestKey: string;
  readonly sourceEventId: string;
  readonly result: Exclude<
    PublishShortcutNotificationOutcomeResult,
    | { readonly kind: "already-processed" }
    | { readonly kind: "source-event-not-found" }
  >;
}

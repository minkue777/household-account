interface ShortcutCommittedSourceEventBase {
  readonly eventId: string;
  readonly householdId: string;
  readonly transactionId: string;
  readonly creatorMemberId: string;
  readonly originChannel: "ios-shortcut";
}

/**
 * Shortcut이 생성하는 초안이 아니라 각 소유 모듈에서 이미 원자 commit된 source event입니다.
 */
export type ShortcutCommittedSourceEvent =
  | (ShortcutCommittedSourceEventBase & {
      readonly eventName: "TransactionRecorded.v1";
      readonly producer: "household-finance.ledger";
    })
  | (ShortcutCommittedSourceEventBase & {
      readonly eventName: "CaptureDuplicateObserved.v1";
      readonly producer: "payment-capture.intake";
    });

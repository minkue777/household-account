export interface ShortcutTransactionRecordedEvent {
  eventId: string;
  eventType: "TransactionRecorded.v1";
  producer: "payment-capture.shortcut-ingestion";
  householdId: string;
  transactionId: string;
  creatorMemberId: string;
  originChannel: "ios-shortcut";
}

export type ShortcutTransactionNotificationResult =
  | { kind: "Delivered"; transactionId: string }
  | { kind: "Failed"; transactionId: string }
  | { kind: "UnknownProviderOutcome"; transactionId: string }
  | { kind: "PermanentFailure"; transactionId: string }
  | { kind: "ContractFailure"; transactionId: string };

/**
 * 확정된 Shortcut 거래 이벤트를 소비해 Quick Edit 대체 알림을 전달합니다.
 * 거래 저장과 원장 변경은 이 입력 경계의 책임이 아닙니다.
 */
export interface ShortcutTransactionNotificationInputPort {
  consume(
    event: ShortcutTransactionRecordedEvent,
  ): Promise<ShortcutTransactionNotificationResult>;
}

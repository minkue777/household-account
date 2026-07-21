export interface CaptureDuplicateObservedEvent {
  eventId: string;
  eventType: "CaptureDuplicateObserved.v1";
  schemaVersion: number;
  producer: string;
  householdId: string;
  existingTransactionId: string;
  recipientMemberId: string;
  occurredAt: string;
}

export type AcceptDuplicateNotificationResult =
  | { kind: "Queued"; intentId: string; deliveryIds: readonly string[] }
  | {
      kind: "AlreadyProcessed";
      intentId: string;
      deliveryIds: readonly string[];
    }
  | { kind: "NoTarget"; intentId: string }
  | {
      kind: "ContractFailure";
      code: "UNKNOWN_PRODUCER" | "UNSUPPORTED_EVENT_VERSION";
    };

export type DeliverDuplicateNotificationResult =
  | { kind: "Delivered" }
  | { kind: "Failed" }
  | { kind: "UnknownProviderOutcome" }
  | { kind: "PermanentFailure" };

/**
 * Payment Capture가 이미 존재하는 거래의 중복을 관찰했다는 공개 이벤트를
 * 소비하는 Notifications 입력 경계입니다. 이 경계는 거래 생성 권한을 갖지 않습니다.
 */
export interface CaptureDuplicateNotificationInputPort {
  accept(
    event: CaptureDuplicateObservedEvent,
  ): Promise<AcceptDuplicateNotificationResult>;
  deliver(deliveryId: string): Promise<DeliverDuplicateNotificationResult>;
}

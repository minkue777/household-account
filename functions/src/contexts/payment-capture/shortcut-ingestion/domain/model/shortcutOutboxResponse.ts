export type ShortcutLedgerResult =
  | {
      readonly kind: "Created";
      readonly transactionId: string;
      readonly creatorMemberId: string;
    }
  | {
      readonly kind: "Duplicate";
      readonly existingTransactionId: string;
      readonly creatorMemberId: string;
    }
  | { readonly kind: "Rejected"; readonly code: string };

export type ShortcutNotificationState =
  | "queued"
  | "delivered"
  | "no-target"
  | "failed"
  | "unknown-provider-outcome"
  | "permanent-failure"
  | "not-requested";

export interface ShortcutPaymentResultV2 {
  readonly contractVersion: "shortcut-payment-response.v2";
  readonly commandId: string;
  readonly transaction:
    | { readonly kind: "created"; readonly transactionId: string }
    | {
        readonly kind: "duplicate";
        readonly existingTransactionId: string;
      }
    | { readonly kind: "rejected"; readonly code: string };
  readonly notification: {
    readonly state: ShortcutNotificationState;
    readonly targetMemberId?: string;
    readonly deliveryId?: string;
  };
}

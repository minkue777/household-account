import type {
  QuickEditAuthSession,
  QuickEditOperation,
  QuickEditTransactionView,
} from "../in/quickEditCommandOutcomeInputPort";

export interface QuickEditNotificationReceipt {
  readonly requesterMemberId: string;
  readonly requestedAt: string;
}

export interface QuickEditSuccessfulCommandSnapshot {
  readonly operation: QuickEditOperation["kind"];
  readonly transaction?: QuickEditTransactionView;
  readonly derivedTransactions: readonly QuickEditTransactionView[];
  readonly notificationReceipts: readonly QuickEditNotificationReceipt[];
}

export type QuickEditCommandGatewayResult =
  | ({ readonly kind: "Succeeded" | "AlreadyProcessed" } &
      QuickEditSuccessfulCommandSnapshot)
  | { readonly kind: "Failed"; readonly code: "SERVER_UNAVAILABLE" }
  | { readonly kind: "Conflict"; readonly code: "VERSION_MISMATCH" };

export interface QuickEditCommandGatewayPort {
  execute(input: {
    readonly transactionId: string;
    readonly operation: QuickEditOperation;
    readonly expectedVersion: number;
    readonly idempotencyKey: string;
  }): Promise<QuickEditCommandGatewayResult>;
}

export interface QuickEditAuthSessionPort {
  current(): QuickEditAuthSession;
}

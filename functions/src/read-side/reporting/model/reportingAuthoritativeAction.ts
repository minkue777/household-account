export interface ReportingTransactionView {
  transactionId: string;
  merchant: string;
  amountInWon: number;
  lifecycle: "active" | "deleted";
  aggregateVersion: number;
}

export interface ReportingMerchantRuleView {
  ruleId: string;
  merchantPattern: string;
  categoryId: string;
  aggregateVersion: number;
}

export type ReportingOwnedAction =
  | {
      kind: "update-transaction";
      commandId: string;
      transactionId: string;
      expectedVersion: number;
      merchant: string;
      amountInWon: number;
    }
  | {
      kind: "delete-transaction";
      commandId: string;
      transactionId: string;
      expectedVersion: number;
    }
  | {
      kind: "save-merchant-rule";
      commandId: string;
      merchantPattern: string;
      categoryId: string;
    };

export interface ReportingUpstreamReceipt {
  receiptId: string;
  commandId: string;
  ownerModule: "ledger" | "payment-configuration";
  aggregateId: string;
  resultingVersion: number;
}

export interface ReportingUpstreamEvent {
  eventType:
    | "TransactionChanged.v1"
    | "TransactionDeleted.v1"
    | "MerchantRuleChanged.v1";
  aggregateId: string;
  aggregateVersion: number;
}

export interface ReportingAuthoritativeState {
  transactions: readonly ReportingTransactionView[];
  merchantRules: readonly ReportingMerchantRuleView[];
  queryRevision: number;
}

export type ReportingOwnedActionResult =
  | {
      kind: "success";
      state: ReportingAuthoritativeState;
      receipt: ReportingUpstreamReceipt;
      event: ReportingUpstreamEvent;
    }
  | {
      kind: "conflict" | "failure";
      code: string;
      state: ReportingAuthoritativeState;
    };

export type ReportingOwnedActionUpstreamResult =
  | {
      kind: "success";
      receipt: ReportingUpstreamReceipt;
      event: ReportingUpstreamEvent;
    }
  | { kind: "conflict" | "failure"; code: string };

export type ReportingAuthoritativeProjection = Omit<
  ReportingAuthoritativeState,
  "queryRevision"
>;

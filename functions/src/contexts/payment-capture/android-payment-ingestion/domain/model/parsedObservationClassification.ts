export interface ParsedCardEvidence {
  readonly companyLabel: string;
  readonly maskedToken?: string;
}

export interface ParsedTransactionEvidence {
  readonly observationType: "approval" | "cancellation";
  readonly amountInWon: number;
  readonly occurredLocalDate: string;
  readonly occurredLocalTime: string;
  readonly merchant: string;
  readonly card?: ParsedCardEvidence;
}

export interface ParsedBalanceEvidence {
  readonly currencyType: string;
  readonly balanceInWon: number;
  readonly observedAt: string;
}

export interface ParsedObservationInput {
  readonly transactionCandidate?: ParsedTransactionEvidence;
  readonly balanceCandidate?: ParsedBalanceEvidence;
}

export interface CaptureEnvelopeView {
  readonly contractVersion: "capture-envelope.v1";
  readonly originChannel: "android-notification";
  readonly paymentObservation?: {
    readonly branchId: string;
    readonly observationType: "approval" | "cancellation";
    readonly amountInWon: number;
    readonly occurredLocalDate: string;
    readonly occurredLocalTime: string;
    readonly zoneId: "Asia/Seoul";
    readonly merchantEvidence: { readonly rawCandidate: string };
    readonly cardEvidence?: ParsedCardEvidence;
  };
  readonly balanceObservation?: ParsedBalanceEvidence & {
    readonly branchId: string;
  };
}

export type ParsedObservationClassificationResult =
  | { readonly kind: "accepted"; readonly envelope: CaptureEnvelopeView }
  | {
      readonly kind: "ignored" | "rejected";
      readonly code:
        | "PARSE_FAILED"
        | "INVALID_AMOUNT"
        | "INVALID_DATE"
        | "INVALID_TIME";
    };

export interface ParsedObservationBranchIds {
  readonly paymentBranchId?: string;
  readonly balanceBranchId?: string;
}

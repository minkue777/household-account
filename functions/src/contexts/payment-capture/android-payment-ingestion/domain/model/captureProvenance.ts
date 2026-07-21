export interface CaptureProvenance {
  readonly observationId: string;
  readonly captureLineageId: string;
  readonly source: {
    readonly sourceType: string;
    readonly registryVersion: string;
  };
  readonly parser: {
    readonly parserId: string;
    readonly parserVersion: string;
  };
  readonly originalAmountInWon: number;
  readonly originalMerchantEvidence: string;
  readonly originalCardEvidence: {
    readonly companyLabel: string;
    readonly maskedToken?: string;
  };
  readonly originalOccurredLocalDate: string;
  readonly originalOccurredLocalTime: string;
  readonly rawPayloadHash: string;
}

export interface CapturedTransaction {
  readonly transactionId: string;
  readonly householdId: string;
  readonly creatorMemberId: string;
  readonly captureLineageIds: readonly string[];
  readonly lifecycle: "active" | "superseded";
  readonly displayed: {
    readonly amountInWon: number;
    readonly merchant: string;
    readonly occurredLocalDate: string;
    readonly occurredLocalTime: string;
  };
  readonly provenanceByLineage: Readonly<Record<string, CaptureProvenance>>;
}

export interface ApprovalCaptureInput {
  readonly transactionId: string;
  readonly actor: {
    readonly householdId: string;
    readonly memberId?: string;
    readonly capability: "paymentCapture:submit";
  };
  readonly provenance: CaptureProvenance;
}

export interface CancellationEvidence {
  readonly amountInWon: number;
  readonly merchantEvidence: string;
  readonly cardEvidence: {
    readonly companyLabel: string;
    readonly maskedToken?: string;
  };
  readonly occurredLocalDate: string;
  readonly occurredLocalTime: string;
}

export type ApprovalCaptureResult =
  | {
      readonly kind: "Created";
      readonly transactionId: string;
      readonly captureLineageId: string;
      readonly creatorMemberId: string;
    }
  | { readonly kind: "Duplicate"; readonly existingTransactionId: string }
  | { readonly kind: "Rejected"; readonly code: "CREATOR_REQUIRED" };

export type ProvenanceCancellationResult =
  | {
      readonly kind: "Cancelled";
      readonly captureLineageId: string;
      readonly deletedTransactionIds: readonly string[];
      readonly restoredTransactionIds: readonly string[];
    }
  | { readonly kind: "NotFound" }
  | {
      readonly kind: "NeedsConfirmation";
      readonly captureLineageIds: readonly string[];
    }
  | {
      readonly kind: "ContractFailure";
      readonly code: "INCOMPLETE_LEGACY_LINEAGE";
    }
  | {
      readonly kind: "RetryableFailure";
      readonly code: "ATOMIC_COMMIT_FAILED";
    };

export interface CaptureDedupClaimView {
  readonly fingerprint: string;
  readonly transactionId: string;
  readonly state: "active" | "cancelled";
}

export interface CaptureDedupClaim extends CaptureDedupClaimView {
  readonly captureLineageId: string;
}

export interface CaptureCancellationReceipt {
  readonly captureLineageId: string;
  readonly deletedTransactionIds: readonly string[];
  readonly restoredTransactionIds: readonly string[];
}

export interface CaptureProvenanceState {
  readonly transactions: readonly CapturedTransaction[];
  readonly dedupClaims: readonly CaptureDedupClaimView[];
  readonly cancellationReceipts: readonly CaptureCancellationReceipt[];
  readonly rawPayloads: readonly string[];
}

export interface CaptureProvenanceAggregateState {
  readonly transactions: readonly CapturedTransaction[];
  readonly dedupClaims: readonly CaptureDedupClaim[];
  readonly cancellationReceipts: readonly CaptureCancellationReceipt[];
  readonly legacyIncompleteLineageIds: readonly string[];
}

import type {
  CaptureBalanceBranchResult,
  CaptureBranchEnvelope,
  CaptureTransactionBranchResult,
} from "../in/captureBranchSubmissionInputPort";

export type CaptureReceiptBranch<TResult> =
  | { readonly stage: "absent" }
  | { readonly stage: "pending"; readonly downstreamKey: string }
  | {
      readonly stage: "terminal" | "retryable";
      readonly downstreamKey: string;
      readonly result: TResult;
    };

export interface CaptureSubmissionReceipt {
  readonly householdId: string;
  readonly rootIdempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly state:
    | "claimed"
    | "processing"
    | "completed"
    | "partial-retryable";
  readonly transaction: CaptureReceiptBranch<CaptureTransactionBranchResult>;
  readonly balance: CaptureReceiptBranch<CaptureBalanceBranchResult>;
}

export type CaptureReceiptClaimResult =
  | { readonly kind: "claimed"; readonly receipt: CaptureSubmissionReceipt }
  | { readonly kind: "existing"; readonly receipt: CaptureSubmissionReceipt }
  | {
      readonly kind: "conflict";
      readonly code: "IDEMPOTENCY_PAYLOAD_MISMATCH";
    };

export interface CaptureSubmissionReceiptPort {
  claim(input: {
    readonly envelope: CaptureBranchEnvelope;
    readonly payloadFingerprint: string;
  }): Promise<CaptureReceiptClaimResult>;
  save(receipt: CaptureSubmissionReceipt): Promise<void>;
}

export interface CapturePayloadFingerprintPort {
  fingerprint(envelope: CaptureBranchEnvelope): string;
}

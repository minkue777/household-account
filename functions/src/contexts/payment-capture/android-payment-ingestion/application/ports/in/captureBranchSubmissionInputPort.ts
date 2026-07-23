import type { BalanceObservationV1 } from "../../../../../household-finance/local-currency/public";

export interface CaptureTransactionBranch {
  readonly branchKey: string;
  readonly merchant: string;
  readonly amountInWon: number;
  readonly occurredAt: string;
  readonly accountingDate: string;
  readonly sourceType: string;
  readonly parser: {
    readonly parserId: string;
    readonly parserVersion: string;
  };
  readonly rawPayloadHash: string;
  readonly localCurrencyType?: "gyeonggi" | "daejeon" | "sejong";
  readonly captureContext?: {
    readonly observationId: string;
    readonly observationType: "approval" | "cancellation";
    readonly originChannel: "android-notification" | "ios-shortcut";
    readonly creatorMemberId: string;
    readonly cardEvidence?: {
      readonly companyLabel: string;
      readonly maskedToken?: string;
    };
  };
}

export interface CaptureBalanceBranch {
  readonly branchKey: string;
  readonly observation: BalanceObservationV1;
}

export interface CaptureBranchEnvelope {
  readonly rootIdempotencyKey: string;
  readonly householdId: string;
  readonly captureEnvelopeIdentity?: {
    readonly contractVersion: "capture-envelope.v1";
    readonly observationId: string;
    readonly originChannel: "android-notification" | "ios-shortcut";
    readonly sourceIdentity: string;
    readonly observedAt: string;
    readonly parserId: string;
    readonly parserVersion: string;
    readonly rawPayloadHash: string;
  };
  readonly transactionBranch?: CaptureTransactionBranch;
  readonly balanceBranch?: CaptureBalanceBranch;
}

export interface CaptureQuickEditSnapshot {
  readonly transactionId: string;
  readonly merchant: string;
  readonly amountInWon: number;
  readonly accountingDate: string;
  readonly localTime: string;
  readonly categoryId: string;
  readonly memo: string;
  readonly aggregateVersion: number;
}

export type CaptureTransactionBranchResult =
  | {
      readonly kind: "recorded";
      readonly transactionId: string;
      readonly editable: true;
      readonly captureLineageId: string;
      readonly aggregateVersion: number;
      /** 새 receipt에는 존재하며, 배포 전 저장된 receipt replay에서는 없을 수 있습니다. */
      readonly quickEditSnapshot?: CaptureQuickEditSnapshot;
    }
  | {
      readonly kind: "duplicate";
      readonly existingTransactionId: string;
      readonly editable: boolean;
      readonly followUp:
        | {
            readonly kind: "outboxQueued";
            readonly eventType: "CaptureDuplicateObserved.v1";
            readonly eventId: string;
          }
        | { readonly kind: "notRequested" };
    }
  | { readonly kind: "cancelled"; readonly transactionIds: readonly string[] }
  | {
      readonly kind: "needsConfirmation";
      readonly captureLineageIds: readonly string[];
    }
  | { readonly kind: "notFound"; readonly resource: "cancellationTarget" }
  | {
      readonly kind: "rejected";
      readonly code: string;
    }
  | {
      readonly kind: "retryable-failure";
      readonly code: "LEDGER_UNAVAILABLE";
    };

export type CaptureBalanceBranchResult =
  | {
      readonly kind: "recorded";
      readonly status: "created" | "updated" | "staleIgnored";
      readonly balanceId: string;
      readonly balanceVersion: number;
    }
  | { readonly kind: "rejected"; readonly code: string }
  | {
      readonly kind: "retryable-failure";
      readonly code: "BALANCE_REPOSITORY_UNAVAILABLE";
    };

export interface CaptureBranchSubmissionResult {
  readonly kind: "accepted";
  readonly completion: "terminal" | "partial-retryable";
  readonly transactionResult?: CaptureTransactionBranchResult;
  readonly balanceResult?: CaptureBalanceBranchResult;
}

export type CaptureBranchSubmissionOutcome =
  | CaptureBranchSubmissionResult
  | {
      readonly kind: "conflict";
      readonly code: "IDEMPOTENCY_PAYLOAD_MISMATCH";
    };

export interface CaptureBranchSubmissionInputPort {
  submit(
    envelope: CaptureBranchEnvelope,
  ): Promise<CaptureBranchSubmissionOutcome>;
}

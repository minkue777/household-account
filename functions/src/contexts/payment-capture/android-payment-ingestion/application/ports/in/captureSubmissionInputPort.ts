import type { CaptureApprovalActor } from "./captureAuthorizationInputPort";

export type CaptureOriginChannel = "android-notification" | "ios-shortcut";

export type CaptureSourceEvidence =
  | {
      readonly kind: "android-registered-package";
      readonly sourceType: string;
      readonly packageName: string;
      readonly registryVersion: string;
    }
  | {
      readonly kind: "ios-shortcut-credential";
      readonly sourceType: "ios-shortcut";
      readonly credentialIdHash: string;
    };

export interface CapturePaymentObservation {
  readonly branchId: string;
  readonly observationType: "approval" | "cancellation";
  readonly amountInWon: number;
  readonly occurredLocalDate?: string;
  readonly occurredLocalTime?: string;
  readonly zoneId: "Asia/Seoul";
  readonly merchantEvidence: { readonly rawCandidate: string };
  readonly cardEvidence?: {
    readonly companyLabel: string;
    readonly maskedToken?: string;
  };
  readonly localCurrencyType?: "gyeonggi" | "daejeon" | "sejong";
  readonly dueDate?: string;
}

export interface CaptureBalanceObservation {
  readonly branchId: string;
  readonly currencyType: "gyeonggi" | "daejeon" | "sejong";
  readonly balanceInWon: number;
  readonly observedAt: string;
}

export interface CaptureEnvelopeInput {
  readonly contractVersion: "capture-envelope.v1";
  readonly observationId: string;
  readonly originChannel: CaptureOriginChannel;
  readonly sourceEvidence: CaptureSourceEvidence;
  readonly observedAt: string;
  readonly parser: {
    readonly parserId: string;
    readonly parserVersion: string;
  };
  readonly rawPayloadHash: string;
  readonly paymentObservation?: CapturePaymentObservation;
  readonly balanceObservation?: CaptureBalanceObservation;
}

export interface CaptureSubmissionCommand {
  readonly actor: CaptureApprovalActor;
  readonly rootIdempotencyKey: string;
  readonly envelope: CaptureEnvelopeInput;
}

export type CaptureSubmittedTransactionResult =
  | {
      readonly kind: "created";
      readonly transactionId: string;
      readonly editable: true;
      readonly captureLineageId: string;
      readonly aggregateVersion: number;
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
  | { readonly kind: "rejected"; readonly code: string }
  | { readonly kind: "retryableFailure"; readonly code: string };

export type CaptureSubmittedBalanceResult =
  | {
      readonly kind: "recorded";
      readonly status: "created" | "updated" | "staleIgnored";
      readonly balanceId: string;
      readonly balanceVersion: number;
    }
  | { readonly kind: "rejected"; readonly code: string }
  | { readonly kind: "retryableFailure"; readonly code: string };

export interface CaptureSubmissionResult {
  readonly observationId: string;
  readonly transactionResult?: CaptureSubmittedTransactionResult;
  readonly balanceResult?: CaptureSubmittedBalanceResult;
  readonly completion: "terminal" | "partial-retryable";
}

export type CaptureSubmissionOutcome =
  | { readonly kind: "success"; readonly value: CaptureSubmissionResult }
  | {
      readonly kind: "conflict";
      readonly code: "IDEMPOTENCY_PAYLOAD_MISMATCH";
    }
  | { readonly kind: "Unauthenticated"; readonly code: "AUTH_REQUIRED" }
  | {
      readonly kind: "Forbidden";
      readonly code:
        | "HOUSEHOLD_REQUIRED"
        | "ACTOR_MISMATCH"
        | "CAPABILITY_REQUIRED";
    };

export interface CaptureSubmissionInputPort {
  submit(command: CaptureSubmissionCommand): Promise<CaptureSubmissionOutcome>;
}

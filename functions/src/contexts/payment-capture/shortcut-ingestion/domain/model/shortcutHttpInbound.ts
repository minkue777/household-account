import type { ShortcutCredentialActor } from "./shortcutCredentialLifecycle";
import type { ShortcutCardMessageParseResult } from "./shortcutCardMessage";

export interface ShortcutHttpAuthorizedCredential {
  readonly credentialId: string;
  readonly actor: ShortcutCredentialActor;
}

export type ShortcutHttpAuthorizationDecision =
  | { readonly kind: "authorized"; readonly credential: ShortcutHttpAuthorizedCredential }
  | {
      readonly kind: "unauthenticated";
      readonly code:
        | "AUTH_REQUIRED"
        | "CREDENTIAL_REVOKED"
        | "CREDENTIAL_REPLACED"
        | "CREDENTIAL_KEY_VERSION_INVALID";
    }
  | { readonly kind: "forbidden"; readonly code: "HOUSEHOLD_FORBIDDEN" };

export type ShortcutHttpProcessingErrorCode =
  | Extract<ShortcutCardMessageParseResult, { kind: "Rejected" }>["code"]
  | "AUTH_REQUIRED"
  | "CREDENTIAL_REVOKED"
  | "CREDENTIAL_REPLACED"
  | "CREDENTIAL_KEY_VERSION_INVALID"
  | "HOUSEHOLD_FORBIDDEN"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "UNSUPPORTED_MESSAGE"
  | "CARD_NOT_REGISTERED_FOR_ACTOR"
  | "IDEMPOTENCY_PAYLOAD_MISMATCH"
  | "PAYMENT_INTAKE_TEMPORARILY_UNAVAILABLE";

export type ShortcutHttpRequestProcessingResult =
  | {
      readonly kind: "success";
      readonly commandId: string;
      readonly transaction:
        | { readonly kind: "created"; readonly transactionId: string }
        | {
            readonly kind: "duplicate";
            readonly existingTransactionId: string;
          }
        | {
            readonly kind: "cancelled";
            readonly transactionIds: readonly string[];
          }
        | {
            readonly kind: "needsConfirmation";
            readonly candidates: readonly {
              readonly kind: "captureLineage";
              readonly captureLineageId: string;
            }[];
          }
        | {
            readonly kind: "rejected";
            readonly code: "CANCELLATION_TARGET_NOT_FOUND";
          };
      readonly notification:
        | {
            readonly state: "queued";
            readonly targetMemberId: string;
          }
        | { readonly state: "not-requested" };
    }
  | {
      readonly kind: "error";
      readonly code: ShortcutHttpProcessingErrorCode;
      readonly retryable: boolean;
    };

export type ShortcutHttpPaymentIntakeResult =
  | { readonly kind: "created"; readonly transactionId: string }
  | { readonly kind: "duplicate"; readonly existingTransactionId: string }
  | { readonly kind: "cancelled"; readonly transactionIds: readonly string[] }
  | {
      readonly kind: "needs-confirmation";
      readonly captureLineageIds: readonly string[];
    }
  | { readonly kind: "cancellation-not-found" }
  | { readonly kind: "rejected"; readonly code: "CARD_NOT_REGISTERED_FOR_ACTOR" | "IDEMPOTENCY_PAYLOAD_MISMATCH" | "AUTH_REQUIRED" | "HOUSEHOLD_FORBIDDEN" }
  | { readonly kind: "retryable-failure" };

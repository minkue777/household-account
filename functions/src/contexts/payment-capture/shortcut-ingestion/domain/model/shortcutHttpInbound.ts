import type { ShortcutCredentialActor } from "./shortcutCredentialLifecycle";

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
          };
      readonly notification: {
        readonly state: "queued";
        readonly targetMemberId: string;
      };
    }
  | {
      readonly kind: "error";
      readonly code: ShortcutHttpProcessingErrorCode;
      readonly retryable: boolean;
    };

export type ShortcutHttpPaymentIntakeResult =
  | { readonly kind: "created"; readonly transactionId: string }
  | { readonly kind: "duplicate"; readonly existingTransactionId: string }
  | { readonly kind: "rejected"; readonly code: "CARD_NOT_REGISTERED_FOR_ACTOR" }
  | { readonly kind: "retryable-failure" };

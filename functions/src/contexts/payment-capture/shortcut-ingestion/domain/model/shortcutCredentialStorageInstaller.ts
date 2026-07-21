import type { ShortcutCredentialSession } from "./shortcutCredentialLifecycle";

export interface ShortcutDefinition<Endpoint extends string = string> {
  readonly endpoint: Endpoint;
  readonly method: "POST";
  readonly contentType: "application/json";
  readonly headers: {
    readonly Authorization: "Bearer {{importQuestion.shortcutCredential}}";
    readonly "Idempotency-Key": "{{shortcut.executionId}}";
  };
  readonly body: {
    readonly contractVersion: "shortcut-payment.v1";
    readonly message: "{{shortcut.input.paymentMessage}}";
  };
  readonly responseHandling: "ShowTypedPaymentCaptureResult";
  readonly importQuestions: readonly [
    {
      readonly id: "shortcutCredential";
      readonly prompt: "복사한 Shortcut 인증키를 붙여넣으세요";
      readonly secret: true;
    },
  ];
}

export interface ShortcutInstallation<Endpoint extends string = string> {
  readonly definition: ShortcutDefinition<Endpoint>;
  readonly actions: readonly ["CopyCredential", "OpenInstallLink"];
  readonly automationGuidance: {
    readonly trigger: "PersonalPaymentMessage";
    readonly action: "RunInstalledShortcut";
    readonly setup: "UserConnectsOnceOnDevice";
  };
}

export type ShortcutCredentialStorageIssueResult<
  Endpoint extends string = string,
> =
  | {
      readonly kind: "Issued";
      readonly credentialId: string;
      readonly credentialVersion: number;
      readonly rawCredential: string;
      readonly install: ShortcutInstallation<Endpoint>;
    }
  | {
      readonly kind: "AlreadyIssued";
      readonly credentialId: string;
      readonly credentialVersion: number;
    }
  | { readonly kind: "Forbidden"; readonly code: "MEMBERSHIP_REQUIRED" }
  | {
      readonly kind: "RetryableFailure";
      readonly code: "ATOMIC_COMMIT_FAILED";
    };

export type ShortcutCredentialStorageAuthorizationResult =
  | {
      readonly kind: "Authorized";
      readonly actor: {
        readonly householdId: string;
        readonly memberId: string;
      };
    }
  | {
      readonly kind: "Unauthenticated";
      readonly code:
        | "CREDENTIAL_REVOKED"
        | "CREDENTIAL_REPLACED"
        | "CREDENTIAL_KEY_VERSION_INVALID"
        | "AUTH_REQUIRED";
    }
  | { readonly kind: "Forbidden"; readonly code: "MEMBERSHIP_REQUIRED" };

export type ShortcutCredentialStorageSession = ShortcutCredentialSession;

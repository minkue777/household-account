export interface ShortcutCredentialSession {
  readonly principalUid: string;
  readonly householdId: string;
  readonly memberId: string;
  readonly membershipState: "active" | "removed";
  readonly householdState: "active" | "deleted" | "purging";
}

export interface ShortcutCredentialSubject {
  readonly subjectUid: string;
  readonly householdId: string;
  readonly memberId: string;
}

export interface ShortcutCredentialActor {
  readonly principalUid: string;
  readonly householdId: string;
  readonly actingMemberId: string;
  readonly capabilities: readonly ["paymentCapture:submit"];
}

export interface ShortcutCredentialRecord {
  readonly credentialId: string;
  readonly credentialVersion: number;
  readonly subjectUid: string;
  readonly householdId: string;
  readonly memberId: string;
  readonly capabilities: readonly ["paymentCapture:submit"];
  readonly issuedAt: string;
  readonly keyVersion: string;
  readonly secretHash: string;
  readonly status: "active" | "revoked";
  readonly lastUsedAt?: string;
  readonly revokedAt?: string;
  readonly replacedByCredentialId?: string;
}

export type IssueShortcutCredentialResult =
  | {
      readonly kind: "issued";
      readonly credentialId: string;
      readonly credentialVersion: number;
      readonly rawCredential: string;
      readonly installUrl: string;
      readonly issuedAt: string;
    }
  | {
      readonly kind: "alreadyIssued";
      readonly credentialId: string;
      readonly credentialVersion: number;
    }
  | { readonly kind: "forbidden"; readonly code: "HOUSEHOLD_FORBIDDEN" }
  | { readonly kind: "retryableFailure"; readonly code: string };

export type ShortcutCredentialAuthorizationResult =
  | { readonly kind: "authorized"; readonly actor: ShortcutCredentialActor }
  | {
      readonly kind: "unauthenticated";
      readonly httpStatus: 401;
      readonly code:
        | "AUTH_REQUIRED"
        | "CREDENTIAL_REVOKED"
        | "CREDENTIAL_REPLACED"
        | "CREDENTIAL_KEY_VERSION_INVALID";
    }
  | {
      readonly kind: "forbidden";
      readonly httpStatus: 403;
      readonly code: "HOUSEHOLD_FORBIDDEN";
    };

export type ShortcutCredentialStatusResult =
  | {
      readonly kind: "found";
      readonly credential: {
        readonly credentialId: string;
        readonly credentialVersion: number;
        readonly status: "active" | "revoked";
        readonly masked: true;
        readonly issuedAt: string;
        readonly lastUsedAt?: string;
      };
    }
  | { readonly kind: "notFound" }
  | { readonly kind: "forbidden"; readonly code: "HOUSEHOLD_FORBIDDEN" };

export type RevokeShortcutCredentialResult =
  | {
      readonly kind: "revoked";
      readonly credentialId: string;
      readonly credentialVersion: number;
    }
  | { readonly kind: "alreadyRevoked"; readonly credentialId: string }
  | { readonly kind: "notFound" }
  | { readonly kind: "forbidden"; readonly code: "HOUSEHOLD_FORBIDDEN" }
  | {
      readonly kind: "conflict";
      readonly code: "CREDENTIAL_VERSION_MISMATCH";
    };

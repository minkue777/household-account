export type IngressCredential =
  | {
      readonly kind: "user-id-token";
      readonly credentialId: string;
      readonly actorId: string;
      readonly householdId: string;
      readonly actorLifecycle: "active" | "removed";
      readonly expiresAt: string;
    }
  | {
      readonly kind: "service-account";
      readonly credentialId: string;
      readonly serviceIdentity: string;
      readonly scopes: readonly string[];
      readonly expiresAt: string;
      readonly revoked: boolean;
    }
  | {
      readonly kind: "scoped-credential";
      readonly credentialId: string;
      readonly actorId: string;
      readonly householdId: string;
      readonly scopes: readonly string[];
      readonly expiresAt: string;
      readonly revoked: boolean;
    };

export interface CredentialIngressRequest {
  readonly route: "supported-app-refresh" | "operations-refresh";
  readonly origin?: string;
  readonly sourceIp: string;
  readonly credential?: IngressCredential;
  readonly appCheck?: { readonly valid: boolean; readonly appId: string };
  readonly householdId: string;
  readonly requestedAt: string;
}

export interface VerifiedIngressContext {
  readonly principalKind: IngressCredential["kind"];
  readonly principalId: string;
  readonly householdId: string;
  readonly grantedScope: "market.refresh";
}

export type CredentialIngressResult =
  | {
      readonly kind: "accepted";
      readonly context: VerifiedIngressContext;
      readonly applicationReceiptId: string;
    }
  | {
      readonly kind: "rejected";
      readonly code:
        | "CORS_ORIGIN_REJECTED"
        | "AUTH_REQUIRED"
        | "CREDENTIAL_EXPIRED"
        | "CREDENTIAL_REVOKED"
        | "CREDENTIAL_SCOPE_MISSING"
        | "HOUSEHOLD_SCOPE_MISMATCH"
        | "ACTOR_INACTIVE"
        | "APP_CHECK_REJECTED"
        | "CREDENTIAL_RATE_LIMITED"
        | "IP_RATE_LIMITED";
    };

export interface CredentialIngressInputPort {
  invoke(request: CredentialIngressRequest): Promise<CredentialIngressResult>;
}

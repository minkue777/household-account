export interface RefreshRunView {
  readonly runId: string;
  readonly householdId: string;
  readonly status: "COMPLETE" | "PARTIAL_FAILURE";
  readonly targetTotal: number;
  readonly processedTargetIds: readonly string[];
  readonly pageSizes: readonly number[];
  readonly createdAt: string;
}

export type HardenedIngressResult =
  | { readonly kind: "accepted"; readonly run: RefreshRunView }
  | { readonly kind: "no-content"; readonly status: 204 }
  | {
      readonly kind: "rejected";
      readonly code:
        | "METHOD_NOT_ALLOWED"
        | "CONTENT_TYPE_NOT_SUPPORTED"
        | "CONTRACT_VERSION_NOT_SUPPORTED"
        | "BODY_TOO_LARGE"
        | "FIELD_TOO_LARGE"
        | "CORS_ORIGIN_REJECTED"
        | "AUTH_REQUIRED"
        | "APP_CHECK_REJECTED"
        | "HOUSEHOLD_SCOPE_MISMATCH"
        | "RATE_LIMITED"
        | "COST_QUOTA_EXHAUSTED";
    };

export interface PublicRefreshRequest {
  readonly method: "POST" | "GET" | "OPTIONS";
  readonly contentType: string;
  readonly contractVersion: string;
  readonly origin: string;
  readonly authToken?: string;
  readonly appCheckToken?: string;
  readonly householdId: string;
  readonly bodyBytes: number;
  readonly largestFieldChars: number;
  readonly requestedAt: string;
}

export interface HardenedIngressInputPort {
  invoke(request: PublicRefreshRequest): Promise<HardenedIngressResult>;
}

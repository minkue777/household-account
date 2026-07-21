export type HttpScriptStep =
  | { readonly kind: "response"; readonly status: number; readonly bodyBytes: number }
  | {
      readonly kind: "redirect";
      readonly status: 301 | 302 | 307 | 308;
      readonly location: string;
    }
  | { readonly kind: "timeout" }
  | {
      readonly kind: "chunked-response";
      readonly status: 200;
      readonly chunks: readonly number[];
    };

export interface ProviderHttpTarget {
  readonly targetId: string;
  readonly provider: string;
  readonly url: string;
}

export type ProviderHttpOutcome =
  | {
      readonly targetId: string;
      readonly kind: "success";
      readonly attempts: number;
    }
  | {
      readonly targetId: string;
      readonly kind: "retryable-failure";
      readonly code: "TIMEOUT" | "RATE_LIMITED" | "PROVIDER_UNAVAILABLE";
      readonly attempts: number;
    }
  | {
      readonly targetId: string;
      readonly kind: "security-policy-violation";
      readonly code: "HTTPS_REQUIRED" | "HOST_NOT_ALLOWED" | "REDIRECT_NOT_ALLOWED";
      readonly attempts: number;
    }
  | {
      readonly targetId: string;
      readonly kind: "contract-failure";
      readonly code: "RESPONSE_TOO_LARGE" | "HTTP_STATUS_NOT_SUPPORTED";
      readonly attempts: number;
    };

export interface ProviderHttpRunResult {
  readonly outcomes: readonly ProviderHttpOutcome[];
  readonly maxObservedConcurrency: number;
  readonly completed: true;
}

export interface SafeExternalHttpInputPort {
  executeBatch(
    targets: readonly ProviderHttpTarget[],
  ): Promise<ProviderHttpRunResult>;
}

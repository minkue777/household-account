export interface SafeExternalTextHttpRequest {
  readonly provider: string;
  readonly operation: string;
  readonly url: string;
  readonly method?: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export type SafeExternalTextHttpResult =
  | {
      readonly kind: "success";
      readonly body: string;
      readonly finalUrl: string;
      readonly responseBytes: number;
      readonly attempts: number;
    }
  | {
      readonly kind: "retryable-failure";
      readonly code:
        | "TIMEOUT"
        | "NETWORK_FAILURE"
        | "RATE_LIMITED"
        | "PROVIDER_UNAVAILABLE";
      readonly attempts: number;
    }
  | {
      readonly kind: "contract-failure";
      readonly code:
        | "HTTP_STATUS_NOT_SUPPORTED"
        | "RESPONSE_TOO_LARGE"
        | "RESPONSE_BODY_INVALID";
      readonly attempts: number;
    }
  | {
      readonly kind: "security-policy-violation";
      readonly code:
        | "HTTPS_REQUIRED"
        | "PROVIDER_HOST_NOT_ALLOWED"
        | "PORT_NOT_ALLOWED"
        | "REDIRECT_NOT_ALLOWED";
      readonly attempts: number;
    };

export interface SafeExternalTextHttpInputPort {
  execute(
    request: SafeExternalTextHttpRequest,
  ): Promise<SafeExternalTextHttpResult>;
}

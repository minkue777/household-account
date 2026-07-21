export interface ProviderResponseStep {
  readonly kind: "response" | "redirect";
  readonly status?: 200;
  readonly bodyBytes?: number;
  readonly location?: string;
}

export type ProviderScopedHttpResult =
  | {
      readonly kind: "success";
      readonly provider: string;
      readonly finalUrl: string;
      readonly redirectHops: number;
      readonly responseBytes: number;
    }
  | {
      readonly kind: "security-policy-violation";
      readonly code:
        | "HTTPS_REQUIRED"
        | "PROVIDER_HOST_NOT_ALLOWED"
        | "PORT_NOT_ALLOWED"
        | "REDIRECT_LIMIT_EXCEEDED";
      readonly blockedUrl: string;
      readonly networkAttempts: number;
    };

export interface ProviderScopedSafeHttpInputPort {
  get(input: { provider: string; url: string }): Promise<ProviderScopedHttpResult>;
}

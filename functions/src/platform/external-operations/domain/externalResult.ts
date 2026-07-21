export type ExternalResult<T> =
  | { readonly kind: "SUCCESS"; readonly value: T }
  | { readonly kind: "NO_DATA"; readonly reason: string }
  | { readonly kind: "RETRYABLE_FAILURE"; readonly code: string }
  | { readonly kind: "CONTRACT_FAILURE"; readonly code: string }
  | { readonly kind: "INVALID_DATA"; readonly code: string };

export type ProviderObservation =
  | { readonly kind: "response"; readonly status: number; readonly payload: unknown }
  | { readonly kind: "timeout" }
  | { readonly kind: "network-error"; readonly code: string };

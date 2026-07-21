export type ProviderResultKind =
  | "SUCCESS"
  | "NO_DATA"
  | "RETRYABLE_FAILURE"
  | "CONTRACT_FAILURE"
  | "INVALID_DATA";

export interface ProviderQuote {
  readonly instrumentId: string;
  readonly price: number;
  readonly currency: string;
  readonly provider: string;
  readonly observedAt: string;
}

export interface ProviderHealth {
  readonly provider: string;
  readonly operation: string;
  readonly status: "healthy" | "degraded" | "outage";
  readonly lastAttemptAt: string;
  readonly lastSuccessAt?: string;
  readonly consecutiveFailedRuns: number;
  readonly failureStartedAt?: string;
  readonly lastResultKind: ProviderResultKind;
  readonly lastErrorCode?: string;
  readonly alertState: "closed" | "open";
  readonly recoveredAt?: string;
  readonly version: number;
}

export interface RefreshProviderCommand {
  readonly provider: string;
  readonly operation: string;
  readonly executionKey: string;
  readonly expectedData: boolean;
  readonly observedAt: string;
}

export type RefreshProviderResult =
  | {
      readonly kind: "quote-updated";
      readonly quote: ProviderQuote;
      readonly health: ProviderHealth;
    }
  | {
      readonly kind: "last-success-retained";
      readonly quote: ProviderQuote;
      readonly failure: {
        readonly kind: Exclude<ProviderResultKind, "SUCCESS">;
        readonly code: string;
      };
      readonly health: ProviderHealth;
    }
  | {
      readonly kind: "quote-unavailable";
      readonly failure: {
        readonly kind: Exclude<ProviderResultKind, "SUCCESS">;
        readonly code: string;
      };
      readonly health: ProviderHealth;
    };

export interface ProviderHealthInputPort {
  refresh(command: RefreshProviderCommand): Promise<RefreshProviderResult>;
  getQuote(instrumentId: string): Promise<ProviderQuote | undefined>;
  getHealth(provider: string, operation: string): Promise<ProviderHealth | undefined>;
}

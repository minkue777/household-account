import type {
  ProviderHealth,
  ProviderQuote,
  ProviderResultKind,
  RefreshProviderCommand,
  RefreshProviderResult,
} from "../in/providerHealthInputPort";

export interface ProviderAttempt {
  readonly resultKind: ProviderResultKind;
  readonly errorCode?: string;
  readonly attempt: number;
  readonly latencyMs: number;
}

export interface ProviderRun {
  readonly attempts: readonly ProviderAttempt[];
  readonly finalResult:
    | { readonly kind: "SUCCESS"; readonly quote: ProviderQuote }
    | {
        readonly kind: Exclude<ProviderResultKind, "SUCCESS">;
        readonly code: string;
      };
}

export interface ProviderRefreshRunnerPort {
  run(command: RefreshProviderCommand): Promise<ProviderRun>;
}

export interface ProviderHealthRepositoryPort {
  getQuote(instrumentId: string): Promise<ProviderQuote | undefined>;
  findQuote(provider: string, operation: string): Promise<ProviderQuote | undefined>;
  getHealth(provider: string, operation: string): Promise<ProviderHealth | undefined>;
  getReceipt(executionKey: string): Promise<RefreshProviderResult | undefined>;
  commit(input: {
    readonly executionKey: string;
    readonly quote?: ProviderQuote;
    readonly health: ProviderHealth;
    readonly result: RefreshProviderResult;
  }): Promise<void>;
}

export interface ProviderObservationPort {
  record(input: {
    readonly kind: "provider-attempt" | "provider-run-outcome";
    readonly provider: string;
    readonly operation: string;
    readonly executionKeyHash: string;
    readonly resultKind: ProviderResultKind;
    readonly errorCode?: string;
    readonly attempt?: number;
    readonly latencyMs?: number;
    readonly observedAt: string;
  }): void;
}

export interface ProviderAlertPort {
  transition(input: {
    readonly alertIdentity: string;
    readonly transition: "opened" | "resolved";
    readonly notificationChannelResource: string;
    readonly occurredAt: string;
  }): Promise<void>;
}

export interface OperationsHashPort {
  hash(value: string): string;
}

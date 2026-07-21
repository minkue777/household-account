import type {
  HomeActorContext,
  HomeConfigurationCommandResult,
  HomeConfigurationReceipt,
  HomeConfigurationView,
} from "../in/homeConfigurationInputPort";

export interface HomeConfigurationChangedEvent {
  readonly eventType: "HomeConfigurationChanged.v1";
  readonly householdId: string;
  readonly aggregateVersion: number;
  readonly left: HomeConfigurationView["left"];
  readonly right: HomeConfigurationView["right"];
}

export interface HomeIdempotencyRecord {
  readonly payloadFingerprint: string;
  readonly result: HomeConfigurationCommandResult;
}

export interface HomeConfigurationTransactionState {
  readonly configuration: HomeConfigurationView;
  readonly idempotency: Readonly<Record<string, HomeIdempotencyRecord>>;
}

export interface HomeConfigurationMutation<T> {
  readonly state: HomeConfigurationTransactionState;
  readonly value: T;
  readonly receipt?: HomeConfigurationReceipt;
  readonly event?: HomeConfigurationChangedEvent;
}

export interface HomeConfigurationUnitOfWorkPort {
  read(): Promise<HomeConfigurationView>;
  transact<T>(
    operation: (state: HomeConfigurationTransactionState) => HomeConfigurationMutation<T>,
  ): Promise<T>;
}

export interface HomeActorAuthorizationPort {
  authorize(actor: HomeActorContext):
    | { readonly kind: "allowed" }
    | {
        readonly kind: "forbidden";
        readonly code: "INACTIVE_MEMBER" | "HOUSEHOLD_MEMBERSHIP_REQUIRED";
      };
}

export interface AvailableLocalCurrencyPort {
  has(type: string): boolean;
}

export interface HomeCommandFingerprintPort {
  fingerprint(value: unknown): string;
}

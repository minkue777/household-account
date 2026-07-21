import type { HomeCardType } from "../../../domain/homeSummary";

export interface HomeActorContext {
  readonly memberId: string;
  readonly householdId: string;
}

export interface HomeConfigurationView {
  readonly householdId: string;
  readonly left: HomeCardType;
  readonly right: HomeCardType;
  readonly selectedLocalCurrencyType?: string;
  readonly version: number;
  readonly source: "SAVED" | "DEFAULT" | "LEGACY";
}

export interface HomeConfigurationReceipt {
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly householdId: string;
  readonly resultingVersion: number;
}

export type HomeConfigurationCommandResult =
  | {
      readonly kind: "success";
      readonly value: HomeConfigurationView;
      readonly receipt: HomeConfigurationReceipt;
    }
  | {
      readonly kind: "validation-error";
      readonly code:
        | "UNSUPPORTED_HOME_CARD_TYPE"
        | "DUPLICATE_HOME_CARD_TYPE"
        | "LOCAL_CURRENCY_TYPE_NOT_AVAILABLE";
    }
  | {
      readonly kind: "conflict";
      readonly code:
        | "HOME_CONFIGURATION_VERSION_MISMATCH"
        | "IDEMPOTENCY_PAYLOAD_MISMATCH";
    }
  | {
      readonly kind: "forbidden";
      readonly code: "INACTIVE_MEMBER" | "HOUSEHOLD_MEMBERSHIP_REQUIRED";
    };

export interface HomeConfigurationInputPort {
  query(actor: HomeActorContext): Promise<
    | { readonly kind: "success"; readonly value: HomeConfigurationView }
    | {
        readonly kind: "forbidden";
        readonly code: "INACTIVE_MEMBER" | "HOUSEHOLD_MEMBERSHIP_REQUIRED";
      }
  >;
  saveRaw(input: {
    readonly actor: HomeActorContext;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly expectedVersion: number;
    readonly left: unknown;
    readonly right: unknown;
  }): Promise<HomeConfigurationCommandResult>;
  selectLocalCurrency(input: {
    readonly actor: HomeActorContext;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly expectedVersion: number;
    readonly localCurrencyType: string;
  }): Promise<HomeConfigurationCommandResult>;
}

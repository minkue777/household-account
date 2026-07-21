import type { BalanceView } from "./localCurrencyBalancePort";
import type { SupportedLocalCurrencyType } from "../../../domain/model/localCurrencyBalance";

export type BalanceReadState =
  | { kind: "loading" }
  | { kind: "data"; value: BalanceView }
  | { kind: "no-data"; code: "BALANCE_NOT_OBSERVED" }
  | { kind: "failed"; code: string; retryable: boolean };

export type SubscribeBalanceResult =
  | {
      kind: "subscribed";
      subscriptionId: string;
      states: readonly BalanceReadState[];
    }
  | { kind: "selection-required"; code: "LOCAL_CURRENCY_TYPE_REQUIRED" };

export interface BalanceSubscriptionInputPort {
  subscribe(input: {
    householdId: string;
    selectedLocalCurrencyType?: SupportedLocalCurrencyType;
  }): Promise<SubscribeBalanceResult>;
}

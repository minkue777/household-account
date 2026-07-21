import type { BalanceView } from "../in/localCurrencyBalancePort";

export type BalanceSourceOccurrence =
  | { kind: "snapshot"; documents: readonly BalanceView[] }
  | { kind: "failure"; code: string; retryable: boolean };

export interface BalanceSubscriptionSource {
  occurrences(input: {
    householdId: string;
    localCurrencyType: string;
  }): Promise<readonly BalanceSourceOccurrence[]>;
}

export interface BalanceSubscriptionIdGenerator {
  next(): string;
}

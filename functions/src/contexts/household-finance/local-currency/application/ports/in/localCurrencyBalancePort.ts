import type {
  BalanceObservationFact,
  ReadableLocalCurrencyType,
} from "../../../domain/model/localCurrencyBalance";
import type { BalanceObservationValidationCode } from "../../../domain/policies/latestBalanceObservation";

export type LocalCurrencyType = ReadableLocalCurrencyType;
export type BalanceObservation = BalanceObservationFact;

export interface BalanceView {
  balanceId: string;
  householdId: string;
  localCurrencyType: LocalCurrencyType;
  displayName?: string;
  balanceInWon: number;
  observedAt: string;
  updatedAt: string;
  balanceVersion: number;
  schemaVersion: number;
}

export type RecordBalanceSuccess = {
  kind: "success";
  status: "created" | "updated" | "staleIgnored";
  value: BalanceView;
};

export type RecordBalanceResult =
  | RecordBalanceSuccess
  | { kind: "conflict"; code: "IDEMPOTENCY_PAYLOAD_MISMATCH" }
  | { kind: "validation-error"; code: BalanceObservationValidationCode };

export type GetBalanceResult =
  | { kind: "success"; value: BalanceView }
  | { kind: "no-data"; code: "BALANCE_NOT_OBSERVED" }
  | {
      kind: "retryable-failure";
      code: "BALANCE_REPOSITORY_UNAVAILABLE";
    };

export interface LocalCurrencyBalanceInputPort {
  record(input: BalanceObservation): Promise<RecordBalanceResult>;
  get(
    householdId: string,
    localCurrencyType: LocalCurrencyType,
  ): Promise<GetBalanceResult>;
}

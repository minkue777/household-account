import type {
  LegacyLocalCurrencyBalanceState,
  LocalCurrencyBalanceState,
  SupportedLocalCurrencyType,
} from "../../../domain/model/localCurrencyBalance";
import type { RecordBalanceSuccess } from "../in/localCurrencyBalancePort";

export interface BalanceObservationReceipt {
  householdId: string;
  observationId: string;
  payloadFingerprint: string;
  result: RecordBalanceSuccess;
}

export interface LocalCurrencyBalanceChangedEvent {
  balanceId: string;
  householdId: string;
  localCurrencyType: SupportedLocalCurrencyType;
  balanceVersion: number;
  occurredAt: string;
}

export interface LocalCurrencyBalanceTransaction {
  readBalance(
    householdId: string,
    localCurrencyType: SupportedLocalCurrencyType,
  ): Promise<LocalCurrencyBalanceState | null>;
  readReceipt(
    householdId: string,
    observationId: string,
  ): Promise<BalanceObservationReceipt | null>;
  saveBalance(balance: LocalCurrencyBalanceState): Promise<void>;
  saveReceipt(receipt: BalanceObservationReceipt): Promise<void>;
  appendChangedEvent(event: LocalCurrencyBalanceChangedEvent): Promise<void>;
}

export interface LocalCurrencyBalanceStore {
  runInHouseholdTransaction<T>(
    householdId: string,
    operation: (transaction: LocalCurrencyBalanceTransaction) => Promise<T>,
  ): Promise<T>;
  readBalance(
    householdId: string,
    localCurrencyType: SupportedLocalCurrencyType,
  ): Promise<LocalCurrencyBalanceState | null>;
  readLegacyBalance(
    householdId: string,
  ): Promise<LegacyLocalCurrencyBalanceState | null>;
}

export interface LocalCurrencyBalanceClock {
  now(): string;
}

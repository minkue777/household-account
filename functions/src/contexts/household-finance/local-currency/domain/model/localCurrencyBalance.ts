export const SUPPORTED_LOCAL_CURRENCY_TYPES = [
  "gyeonggi",
  "daejeon",
  "sejong",
] as const;

export type SupportedLocalCurrencyType =
  (typeof SUPPORTED_LOCAL_CURRENCY_TYPES)[number];

export type ReadableLocalCurrencyType =
  | SupportedLocalCurrencyType
  | "legacy-unknown";

export interface BalanceObservationFact {
  observationId: string;
  householdId: string;
  localCurrencyType: SupportedLocalCurrencyType;
  balanceInWon: number;
  observedAt: string;
}

export interface LocalCurrencyBalanceState {
  balanceId: string;
  householdId: string;
  localCurrencyType: SupportedLocalCurrencyType;
  displayName?: string;
  balanceInWon: number;
  observedAt: string;
  updatedAt: string;
  balanceVersion: number;
  schemaVersion: number;
  lastObservationId: string;
}

export interface LegacyLocalCurrencyBalanceState {
  balanceId: string;
  householdId: string;
  displayName?: string;
  balanceInWon: number;
  observedAt: string;
  updatedAt: string;
  balanceVersion: number;
  schemaVersion: number;
}

export function isSupportedLocalCurrencyType(
  value: string,
): value is SupportedLocalCurrencyType {
  return (SUPPORTED_LOCAL_CURRENCY_TYPES as readonly string[]).includes(value);
}

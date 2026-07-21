import {
  BalanceObservationFact,
  LocalCurrencyBalanceState,
  isSupportedLocalCurrencyType,
} from "../model/localCurrencyBalance";

export type BalanceObservationValidationCode =
  | "OBSERVATION_ID_REQUIRED"
  | "HOUSEHOLD_ID_REQUIRED"
  | "LOCAL_CURRENCY_TYPE_UNSUPPORTED"
  | "BALANCE_MUST_BE_INTEGER"
  | "OBSERVED_AT_INVALID";

export type BalanceObservationValidation =
  | { kind: "valid"; observedAtEpochMillis: number }
  | { kind: "invalid"; code: BalanceObservationValidationCode };

export function validateBalanceObservation(
  observation: BalanceObservationFact,
): BalanceObservationValidation {
  if (observation.observationId.trim().length === 0) {
    return { kind: "invalid", code: "OBSERVATION_ID_REQUIRED" };
  }
  if (observation.householdId.trim().length === 0) {
    return { kind: "invalid", code: "HOUSEHOLD_ID_REQUIRED" };
  }
  if (!isSupportedLocalCurrencyType(observation.localCurrencyType)) {
    return { kind: "invalid", code: "LOCAL_CURRENCY_TYPE_UNSUPPORTED" };
  }
  if (!Number.isSafeInteger(observation.balanceInWon)) {
    return { kind: "invalid", code: "BALANCE_MUST_BE_INTEGER" };
  }

  const observedAtEpochMillis = Date.parse(observation.observedAt);
  if (!Number.isFinite(observedAtEpochMillis)) {
    return { kind: "invalid", code: "OBSERVED_AT_INVALID" };
  }

  return { kind: "valid", observedAtEpochMillis };
}

export function compareObservationOrder(
  observation: Pick<BalanceObservationFact, "observationId"> & {
    observedAtEpochMillis: number;
  },
  current: Pick<
    LocalCurrencyBalanceState,
    "observedAt" | "lastObservationId"
  >,
): number {
  const currentEpochMillis = Date.parse(current.observedAt);
  if (observation.observedAtEpochMillis !== currentEpochMillis) {
    return observation.observedAtEpochMillis - currentEpochMillis;
  }

  if (observation.observationId === current.lastObservationId) {
    return 0;
  }
  return observation.observationId > current.lastObservationId ? 1 : -1;
}

export function createObservedBalance(
  observation: BalanceObservationFact,
  balanceId: string,
  updatedAt: string,
): LocalCurrencyBalanceState {
  return {
    balanceId,
    householdId: observation.householdId,
    localCurrencyType: observation.localCurrencyType,
    balanceInWon: observation.balanceInWon,
    observedAt: observation.observedAt,
    updatedAt,
    balanceVersion: 1,
    schemaVersion: 2,
    lastObservationId: observation.observationId,
  };
}

export function updateObservedBalance(
  current: LocalCurrencyBalanceState,
  observation: BalanceObservationFact,
  updatedAt: string,
): LocalCurrencyBalanceState {
  return {
    ...current,
    balanceInWon: observation.balanceInWon,
    observedAt: observation.observedAt,
    updatedAt,
    balanceVersion: current.balanceVersion + 1,
    schemaVersion: 2,
    lastObservationId: observation.observationId,
  };
}

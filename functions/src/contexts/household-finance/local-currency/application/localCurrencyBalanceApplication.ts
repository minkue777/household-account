import type {
  BalanceObservation,
  BalanceView,
  GetBalanceResult,
  LocalCurrencyBalanceInputPort,
  LocalCurrencyType,
  RecordBalanceResult,
  RecordBalanceSuccess,
} from "./ports/in/localCurrencyBalancePort";
import type {
  BalanceObservationReceipt,
  LocalCurrencyBalanceClock,
  LocalCurrencyBalanceStore,
} from "./ports/outbound/localCurrencyBalanceStore";
import type {
  LegacyLocalCurrencyBalanceState,
  LocalCurrencyBalanceState,
} from "../domain/model/localCurrencyBalance";
import {
  compareObservationOrder,
  createObservedBalance,
  updateObservedBalance,
  validateBalanceObservation,
} from "../domain/policies/latestBalanceObservation";

function balanceIdentity(
  householdId: string,
  localCurrencyType: string,
): string {
  return `local-currency-balance:v2:${encodeURIComponent(householdId)}:${localCurrencyType}`;
}

function observationFingerprint(observation: BalanceObservation): string {
  return JSON.stringify([
    observation.householdId,
    observation.observationId,
    observation.localCurrencyType,
    observation.balanceInWon,
    observation.observedAt,
  ]);
}

function toBalanceView(balance: LocalCurrencyBalanceState): BalanceView {
  const {
    lastObservationId: _lastObservationId,
    ...view
  } = balance;
  return view;
}

function toLegacyBalanceView(
  balance: LegacyLocalCurrencyBalanceState,
): BalanceView {
  return {
    ...balance,
    localCurrencyType: "legacy-unknown",
    displayName: balance.displayName ?? "지역화폐",
  };
}

class DefaultLocalCurrencyBalanceApplication
  implements LocalCurrencyBalanceInputPort
{
  constructor(
    private readonly store: LocalCurrencyBalanceStore,
    private readonly clock: LocalCurrencyBalanceClock,
  ) {}

  async record(input: BalanceObservation): Promise<RecordBalanceResult> {
    const validation = validateBalanceObservation(input);
    if (validation.kind === "invalid") {
      return { kind: "validation-error", code: validation.code };
    }

    const payloadFingerprint = observationFingerprint(input);

    return this.store.runInHouseholdTransaction(
      input.householdId,
      async (transaction) => {
        const previousReceipt = await transaction.readReceipt(
          input.householdId,
          input.observationId,
        );
        if (previousReceipt !== null) {
          return previousReceipt.payloadFingerprint === payloadFingerprint
            ? previousReceipt.result
            : {
                kind: "conflict" as const,
                code: "IDEMPOTENCY_PAYLOAD_MISMATCH" as const,
              };
        }

        const current = await transaction.readBalance(
          input.householdId,
          input.localCurrencyType,
        );

        let result: RecordBalanceSuccess;
        let changed: LocalCurrencyBalanceState | null = null;

        if (
          current !== null &&
          compareObservationOrder(
            {
              observationId: input.observationId,
              observedAtEpochMillis: validation.observedAtEpochMillis,
            },
            current,
          ) <= 0
        ) {
          result = {
            kind: "success",
            status: "staleIgnored",
            value: toBalanceView(current),
          };
        } else {
          const updatedAt = this.clock.now();
          changed =
            current === null
              ? createObservedBalance(
                  input,
                  balanceIdentity(input.householdId, input.localCurrencyType),
                  updatedAt,
                )
              : updateObservedBalance(current, input, updatedAt);
          result = {
            kind: "success",
            status: current === null ? "created" : "updated",
            value: toBalanceView(changed),
          };
        }

        const receipt: BalanceObservationReceipt = {
          householdId: input.householdId,
          observationId: input.observationId,
          payloadFingerprint,
          result,
        };

        if (changed !== null) {
          await transaction.saveBalance(changed);
          await transaction.appendChangedEvent({
            balanceId: changed.balanceId,
            householdId: changed.householdId,
            localCurrencyType: changed.localCurrencyType,
            balanceVersion: changed.balanceVersion,
            occurredAt: changed.updatedAt,
          });
        }
        await transaction.saveReceipt(receipt);

        return result;
      },
    );
  }

  async get(
    householdId: string,
    localCurrencyType: LocalCurrencyType,
  ): Promise<GetBalanceResult> {
    try {
      if (localCurrencyType === "legacy-unknown") {
        const legacy = await this.store.readLegacyBalance(householdId);
        return legacy === null
          ? { kind: "no-data", code: "BALANCE_NOT_OBSERVED" }
          : { kind: "success", value: toLegacyBalanceView(legacy) };
      }

      const balance = await this.store.readBalance(
        householdId,
        localCurrencyType,
      );
      return balance === null
        ? { kind: "no-data", code: "BALANCE_NOT_OBSERVED" }
        : { kind: "success", value: toBalanceView(balance) };
    } catch {
      return {
        kind: "retryable-failure",
        code: "BALANCE_REPOSITORY_UNAVAILABLE",
      };
    }
  }
}

export function createLocalCurrencyBalanceApplication(
  store: LocalCurrencyBalanceStore,
  clock: LocalCurrencyBalanceClock,
): LocalCurrencyBalanceInputPort {
  return new DefaultLocalCurrencyBalanceApplication(store, clock);
}

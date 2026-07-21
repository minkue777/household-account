import type {
  BalanceObservationIntakeInputPort,
  BalanceObservationIntakeResult,
  BalanceObservationV1,
  BalanceRecorderActor,
} from "./ports/in/balanceObservationIntakePort";
import type { LocalCurrencyBalanceInputPort } from "./ports/in/localCurrencyBalancePort";
import { validateBalanceObservationEnvelope } from "../domain/policies/balanceObservationEnvelope";

export function createBalanceObservationIntakeApplication(input: {
  balances: LocalCurrencyBalanceInputPort;
}): BalanceObservationIntakeInputPort {
  return {
    recordBalanceObservation: async (
      actor: BalanceRecorderActor,
      observation: BalanceObservationV1,
    ): Promise<BalanceObservationIntakeResult> => {
      if (actor.householdId === undefined || actor.householdId.trim().length === 0) {
        return { kind: "forbidden", code: "HOUSEHOLD_SCOPE_REQUIRED" };
      }
      if (!actor.capabilities.includes("local-currency.record")) {
        return {
          kind: "forbidden",
          code: "LOCAL_CURRENCY_RECORD_CAPABILITY_REQUIRED",
        };
      }
      const candidate = observation as BalanceObservationV1 & {
        rawPayload?: unknown;
      };
      const validation = validateBalanceObservationEnvelope({
        contractVersion: observation.contractVersion,
        observationId: observation.observationId,
        localCurrencyType: observation.localCurrencyType,
        balanceInWon: observation.balanceInWon,
        observedAt: observation.observedAt,
        sourceType: observation.sourceType,
        parser: observation.parser,
        hasRawPayload: Object.prototype.hasOwnProperty.call(
          candidate,
          "rawPayload",
        ),
      });
      if (validation.kind !== "valid") return validation;

      const recorded = await input.balances.record({
        observationId: observation.observationId,
        householdId: actor.householdId,
        localCurrencyType: validation.localCurrencyType,
        balanceInWon: observation.balanceInWon,
        observedAt: observation.observedAt,
      });
      if (recorded.kind === "conflict") {
        return { kind: "contract-failure", code: recorded.code };
      }
      if (recorded.kind === "validation-error") {
        const code =
          recorded.code === "OBSERVED_AT_INVALID"
            ? "INVALID_OBSERVED_AT"
            : recorded.code;
        return { kind: "validation-error", code };
      }
      return {
        kind: "success",
        status: recorded.status,
        balanceId: recorded.value.balanceId,
        balanceVersion: recorded.value.balanceVersion,
      };
    },
  };
}

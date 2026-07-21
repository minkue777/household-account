import { isHomeCardType } from "../domain/homeSummary";
import type {
  HomeActorContext,
  HomeConfigurationCommandResult,
  HomeConfigurationInputPort,
} from "./ports/in/homeConfigurationInputPort";
import type {
  AvailableLocalCurrencyPort,
  HomeActorAuthorizationPort,
  HomeCommandFingerprintPort,
  HomeConfigurationUnitOfWorkPort,
} from "./ports/out/homeConfigurationPorts";

export function createHomeConfigurationApplication(dependencies: {
  readonly authorization: HomeActorAuthorizationPort;
  readonly currencies: AvailableLocalCurrencyPort;
  readonly uow: HomeConfigurationUnitOfWorkPort;
  readonly fingerprint: HomeCommandFingerprintPort;
}): HomeConfigurationInputPort {
  function forbidden(actor: HomeActorContext) {
    return dependencies.authorization.authorize(actor);
  }

  return {
    async query(actor) {
      const authorization = forbidden(actor);
      if (authorization.kind === "forbidden") return authorization;
      return { kind: "success", value: await dependencies.uow.read() };
    },

    async saveRaw(input) {
      const authorization = forbidden(input.actor);
      if (authorization.kind === "forbidden") return authorization;
      const left = input.left;
      const right = input.right;
      if (!isHomeCardType(left) || !isHomeCardType(right)) {
        return { kind: "validation-error", code: "UNSUPPORTED_HOME_CARD_TYPE" };
      }
      if (left === right) {
        return { kind: "validation-error", code: "DUPLICATE_HOME_CARD_TYPE" };
      }
      const payloadFingerprint = dependencies.fingerprint.fingerprint({
        commandId: input.commandId,
        actor: input.actor,
        expectedVersion: input.expectedVersion,
        left,
        right,
      });
      return dependencies.uow.transact<HomeConfigurationCommandResult>((state) => {
        const replay = state.idempotency[input.idempotencyKey];
        if (replay !== undefined) {
          return {
            state,
            value:
              replay.payloadFingerprint === payloadFingerprint
                ? replay.result
                : { kind: "conflict", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" },
          };
        }
        if (state.configuration.version !== input.expectedVersion) {
          return {
            state,
            value: { kind: "conflict", code: "HOME_CONFIGURATION_VERSION_MISMATCH" },
          };
        }
        const value = {
          ...state.configuration,
          left,
          right,
          version: state.configuration.version + 1,
          source: "SAVED" as const,
        };
        const receipt = {
          commandId: input.commandId,
          idempotencyKey: input.idempotencyKey,
          householdId: value.householdId,
          resultingVersion: value.version,
        };
        const result: HomeConfigurationCommandResult = {
          kind: "success",
          value,
          receipt,
        };
        return {
          state: {
            configuration: value,
            idempotency: {
              ...state.idempotency,
              [input.idempotencyKey]: { payloadFingerprint, result },
            },
          },
          value: result,
          receipt,
          event: {
            eventType: "HomeConfigurationChanged.v1",
            householdId: value.householdId,
            aggregateVersion: value.version,
            left: value.left,
            right: value.right,
          },
        };
      });
    },

    async selectLocalCurrency(input) {
      const authorization = forbidden(input.actor);
      if (authorization.kind === "forbidden") return authorization;
      if (!dependencies.currencies.has(input.localCurrencyType)) {
        return {
          kind: "validation-error",
          code: "LOCAL_CURRENCY_TYPE_NOT_AVAILABLE",
        };
      }
      const payloadFingerprint = dependencies.fingerprint.fingerprint({
        commandId: input.commandId,
        actor: input.actor,
        expectedVersion: input.expectedVersion,
        localCurrencyType: input.localCurrencyType,
      });
      return dependencies.uow.transact<HomeConfigurationCommandResult>((state) => {
        const replay = state.idempotency[input.idempotencyKey];
        if (replay !== undefined) {
          return {
            state,
            value:
              replay.payloadFingerprint === payloadFingerprint
                ? replay.result
                : { kind: "conflict", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" },
          };
        }
        if (state.configuration.version !== input.expectedVersion) {
          return {
            state,
            value: { kind: "conflict", code: "HOME_CONFIGURATION_VERSION_MISMATCH" },
          };
        }
        const value = {
          ...state.configuration,
          selectedLocalCurrencyType: input.localCurrencyType,
          version: state.configuration.version + 1,
          source: "SAVED" as const,
        };
        const receipt = {
          commandId: input.commandId,
          idempotencyKey: input.idempotencyKey,
          householdId: value.householdId,
          resultingVersion: value.version,
        };
        const result: HomeConfigurationCommandResult = {
          kind: "success",
          value,
          receipt,
        };
        return {
          state: {
            configuration: value,
            idempotency: {
              ...state.idempotency,
              [input.idempotencyKey]: { payloadFingerprint, result },
            },
          },
          value: result,
          receipt,
        };
      });
    },
  };
}

import type {
  ExternalResult,
  ProviderObservation,
} from "./externalResult";

function objectPayload(payload: unknown): Record<string, unknown> | undefined {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : undefined;
}

export function classifyNumericObservation(input: {
  readonly observation: ProviderObservation;
  readonly valueField: string;
  readonly schemaErrorCode: string;
  readonly numberErrorCode: string;
}): ExternalResult<number> {
  const observation = input.observation;
  if (observation.kind === "timeout") {
    return { kind: "RETRYABLE_FAILURE", code: "TIMEOUT" };
  }
  if (observation.kind === "network-error") {
    return { kind: "RETRYABLE_FAILURE", code: observation.code };
  }
  if (
    observation.status === 408 ||
    observation.status === 429 ||
    observation.status >= 500
  ) {
    return {
      kind: "RETRYABLE_FAILURE",
      code: `HTTP_${observation.status}`,
    };
  }
  if (observation.status !== 200) {
    return {
      kind: "CONTRACT_FAILURE",
      code: `HTTP_${observation.status}`,
    };
  }

  const payload = objectPayload(observation.payload);
  if (payload?.availability === "NO_DATA") {
    return { kind: "NO_DATA", reason: "PROVIDER_REPORTED_NO_DATA" };
  }
  if (payload === undefined || !(input.valueField in payload)) {
    return { kind: "CONTRACT_FAILURE", code: input.schemaErrorCode };
  }
  const value = payload[input.valueField];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { kind: "INVALID_DATA", code: input.numberErrorCode };
  }
  return { kind: "SUCCESS", value };
}

export function classifyQuoteObservation(
  observation: ProviderObservation,
): ExternalResult<number> {
  return classifyNumericObservation({
    observation,
    valueField: "quoteInWon",
    schemaErrorCode: "QUOTE_SCHEMA_INVALID",
    numberErrorCode: "QUOTE_NUMBER_INVALID",
  });
}

export function classifyGoldObservation(
  observation: ProviderObservation,
): ExternalResult<number> {
  return classifyNumericObservation({
    observation,
    valueField: "goldPriceInWon",
    schemaErrorCode: "GOLD_SCHEMA_INVALID",
    numberErrorCode: "GOLD_NUMBER_INVALID",
  });
}

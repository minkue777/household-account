import {
  isSupportedLocalCurrencyType,
  type SupportedLocalCurrencyType,
} from "../model/localCurrencyBalance";

export type BalanceObservationEnvelopeValidation =
  | { kind: "valid"; localCurrencyType: SupportedLocalCurrencyType }
  | { kind: "validation-error"; code: string }
  | { kind: "contract-failure"; code: string };

export function validateBalanceObservationEnvelope(input: {
  contractVersion: string;
  observationId: string;
  localCurrencyType: string;
  balanceInWon: number;
  observedAt: string;
  sourceType: string;
  parser?: { parserId: string; parserVersion: string };
  hasRawPayload: boolean;
}): BalanceObservationEnvelopeValidation {
  if (input.contractVersion !== "balance-observation.v1") {
    return {
      kind: "contract-failure",
      code: "UNSUPPORTED_OBSERVATION_VERSION",
    };
  }
  if (!isSupportedLocalCurrencyType(input.localCurrencyType)) {
    return {
      kind: "contract-failure",
      code: "UNSUPPORTED_LOCAL_CURRENCY_TYPE",
    };
  }
  if (input.hasRawPayload) {
    return { kind: "validation-error", code: "RAW_PAYLOAD_NOT_ALLOWED" };
  }
  if (input.observationId.trim().length === 0) {
    return { kind: "validation-error", code: "OBSERVATION_ID_REQUIRED" };
  }
  if (!Number.isSafeInteger(input.balanceInWon)) {
    return { kind: "validation-error", code: "BALANCE_MUST_BE_INTEGER" };
  }
  if (!Number.isFinite(Date.parse(input.observedAt))) {
    return { kind: "validation-error", code: "INVALID_OBSERVED_AT" };
  }
  if (input.sourceType.trim().length === 0) {
    return { kind: "validation-error", code: "SOURCE_TYPE_REQUIRED" };
  }
  if (
    input.parser === undefined ||
    input.parser.parserId.trim().length === 0 ||
    input.parser.parserVersion.trim().length === 0
  ) {
    return { kind: "validation-error", code: "PARSER_METADATA_REQUIRED" };
  }
  return { kind: "valid", localCurrencyType: input.localCurrencyType };
}

import type { CaptureEnvelopeInput } from "./ports/in/captureSubmissionInputPort";
import {
  ANDROID_PAYMENT_SOURCE_REGISTRY,
  type AndroidPaymentSourceRegistryEntry,
} from "../domain/model/defaultPaymentSourceRegistry";

export type AndroidCaptureSourceValidation =
  | { readonly kind: "allowed"; readonly entry: AndroidPaymentSourceRegistryEntry }
  | {
      readonly kind: "rejected";
      readonly code:
        | "ANDROID_SOURCE_REQUIRED"
        | "UNSUPPORTED_SOURCE"
        | "SOURCE_EVIDENCE_MISMATCH"
        | "CARD_EVIDENCE_REQUIRED"
        | "LOCAL_CURRENCY_TYPE_MISMATCH";
    };

export function validateAndroidCaptureSource(
  envelope: CaptureEnvelopeInput,
  registry: readonly AndroidPaymentSourceRegistryEntry[] =
    ANDROID_PAYMENT_SOURCE_REGISTRY,
): AndroidCaptureSourceValidation {
  if (
    envelope.originChannel !== "android-notification" ||
    envelope.sourceEvidence.kind !== "android-registered-package"
  ) {
    return { kind: "rejected", code: "ANDROID_SOURCE_REQUIRED" };
  }
  const sourceEvidence = envelope.sourceEvidence;

  const matches = registry.filter(
    (candidate) =>
      candidate.packageName === sourceEvidence.packageName &&
      candidate.sourceState === "active" &&
      candidate.parserState === "active",
  );
  if (matches.length !== 1) {
    return { kind: "rejected", code: "UNSUPPORTED_SOURCE" };
  }
  const source = matches[0];
  if (
    source.sourceType !== sourceEvidence.sourceType ||
    source.registryVersion !== sourceEvidence.registryVersion ||
    source.parserId !== envelope.parser.parserId ||
    source.parserVersion !== envelope.parser.parserVersion
  ) {
    return { kind: "rejected", code: "SOURCE_EVIDENCE_MISMATCH" };
  }
  if (
    envelope.paymentObservation !== undefined &&
    !source.cityGas &&
    envelope.paymentObservation.cardEvidence === undefined
  ) {
    return { kind: "rejected", code: "CARD_EVIDENCE_REQUIRED" };
  }
  const observedTypes = [
    envelope.paymentObservation?.localCurrencyType,
    envelope.balanceObservation?.currencyType,
  ].filter((value): value is "gyeonggi" | "daejeon" | "sejong" =>
    value !== undefined,
  );
  if (
    observedTypes.some(
      (currencyType) => source.localCurrencyType !== currencyType,
    )
  ) {
    return { kind: "rejected", code: "LOCAL_CURRENCY_TYPE_MISMATCH" };
  }

  return { kind: "allowed", entry: source };
}

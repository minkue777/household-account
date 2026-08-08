import type { CaptureEnvelopeInput } from "./ports/in/captureSubmissionInputPort";
import {
  ANDROID_PAYMENT_SOURCE_REGISTRY,
  type AndroidPaymentSourceRegistryEntry,
} from "../domain/model/defaultPaymentSourceRegistry";
import {
  isCityGasBillShape,
  KAKAO_TALK_FINANCIAL_SOURCE,
} from "../domain/policies/kakaoTalkPaymentKindPolicy";

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

function isLegacyKakaoCityGasEvidence(
  envelope: CaptureEnvelopeInput,
  source: AndroidPaymentSourceRegistryEntry,
): boolean {
  const evidence = envelope.sourceEvidence;
  const payment = envelope.paymentObservation;
  return (
    evidence.kind === "android-registered-package" &&
    source.packageName === KAKAO_TALK_FINANCIAL_SOURCE.packageName &&
    source.sourceType === KAKAO_TALK_FINANCIAL_SOURCE.sourceType &&
    source.parserId === KAKAO_TALK_FINANCIAL_SOURCE.parserId &&
    source.parserVersion === KAKAO_TALK_FINANCIAL_SOURCE.parserVersion &&
    source.supportsCityGasBill &&
    evidence.packageName === KAKAO_TALK_FINANCIAL_SOURCE.packageName &&
    evidence.sourceType === "city-gas-bill" &&
    evidence.registryVersion === "source-registry.v1" &&
    envelope.parser.parserId === "city-gas-bill-parser" &&
    envelope.parser.parserVersion === "1.0.0" &&
    payment !== undefined &&
    isCityGasBillShape({
      observationType: payment.observationType,
      amountInWon: payment.amountInWon,
      occurredLocalDate: payment.occurredLocalDate,
      merchant: payment.merchantEvidence.rawCandidate,
      cardEvidence: payment.cardEvidence,
      localCurrencyType: payment.localCurrencyType,
      dueDate: payment.dueDate,
      hasBalance: envelope.balanceObservation !== undefined,
    })
  );
}

const LEGACY_SAMSUNG_SEMANTIC_PARSERS: Readonly<
  Record<string, { readonly sourceType: string; readonly parserId: string }>
> = Object.freeze({
  "com.google.android.apps.messaging": {
    sourceType: "sms-card-message",
    parserId: "sms-card-message-parser",
  },
  "com.samsung.android.messaging": {
    sourceType: "sms-card-message",
    parserId: "sms-card-message-parser",
  },
  "com.android.mms": {
    sourceType: "sms-card-message",
    parserId: "sms-card-message-parser",
  },
  "com.samsung.android.spay": {
    sourceType: "samsung-card",
    parserId: "samsung-card-parser",
  },
  "kr.co.samsungcard.mpocket": {
    sourceType: "samsung-card",
    parserId: "samsung-card-parser",
  },
});

function isLegacySamsungSemanticParserVersion(
  envelope: CaptureEnvelopeInput,
  source: AndroidPaymentSourceRegistryEntry,
): boolean {
  const evidence = envelope.sourceEvidence;
  if (evidence.kind !== "android-registered-package") return false;
  const legacy = LEGACY_SAMSUNG_SEMANTIC_PARSERS[evidence.packageName];
  const payment = envelope.paymentObservation;
  return (
    legacy !== undefined &&
    source.packageName === evidence.packageName &&
    source.sourceType === legacy.sourceType &&
    source.parserId === legacy.parserId &&
    source.parserVersion === "1.1.0" &&
    evidence.sourceType === legacy.sourceType &&
    evidence.registryVersion === source.registryVersion &&
    envelope.parser.parserId === legacy.parserId &&
    envelope.parser.parserVersion === "1.0.0" &&
    payment !== undefined &&
    payment.localCurrencyType === undefined &&
    payment.dueDate === undefined &&
    envelope.balanceObservation === undefined
  );
}

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
  const currentEvidenceMismatch =
    source.sourceType !== sourceEvidence.sourceType ||
    source.registryVersion !== sourceEvidence.registryVersion ||
    source.parserId !== envelope.parser.parserId ||
    source.parserVersion !== envelope.parser.parserVersion;
  const legacyKakaoCityGas = isLegacyKakaoCityGasEvidence(envelope, source);
  const legacySamsungParserVersion =
    isLegacySamsungSemanticParserVersion(envelope, source);
  if (
    currentEvidenceMismatch &&
    !legacyKakaoCityGas &&
    !legacySamsungParserVersion
  ) {
    return { kind: "rejected", code: "SOURCE_EVIDENCE_MISMATCH" };
  }
  if (
    envelope.paymentObservation !== undefined &&
    !legacyKakaoCityGas &&
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

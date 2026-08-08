import { describe, expect, it } from "vitest";

import { decodeCaptureEnvelope } from "../../../src/adapters/firebase/payment-capture/captureEnvelopeDecoder";
import { validateAndroidCaptureSource } from "../../../src/contexts/payment-capture/android-payment-ingestion/application/validateAndroidCaptureSource";

function validEnvelope(): Record<string, unknown> {
  return {
    contractVersion: "capture-envelope.v1",
    observationId: "observation-1",
    originChannel: "android-notification",
    sourceEvidence: {
      kind: "android-registered-package",
      sourceType: "kb-card",
      packageName: "com.kbcard.cxh.appcard",
      registryVersion: "source-registry.v1",
    },
    observedAt: "2026-07-21T10:05:01+09:00",
    parser: { parserId: "kb-card-parser", parserVersion: "2.0.0" },
    rawPayloadHash:
      "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    paymentObservation: {
      branchId: "payment-1",
      observationType: "approval",
      amountInWon: 12_000,
      occurredLocalDate: "2026-07-21",
      occurredLocalTime: "10:05",
      zoneId: "Asia/Seoul",
      merchantEvidence: { rawCandidate: "가맹점 A" },
      cardEvidence: { companyLabel: "국민", maskedToken: "1234" },
    },
  };
}

function legacyKakaoBillEnvelope(): Record<string, unknown> {
  const input = validEnvelope();
  Object.assign(input.sourceEvidence as Record<string, unknown>, {
    sourceType: "city-gas-bill",
    packageName: "com.kakao.talk",
  });
  Object.assign(input.parser as Record<string, unknown>, {
    parserId: "city-gas-bill-parser",
    parserVersion: "1.0.0",
  });
  const payment = input.paymentObservation as Record<string, unknown>;
  Object.assign(payment, {
    observationType: "approval",
    occurredLocalDate: "2026-07-21",
    merchantEvidence: { rawCandidate: "7월 도시가스요금" },
    dueDate: "2026-07-21",
  });
  delete payment.cardEvidence;
  return input;
}

function legacySamsungSemanticEnvelope(input: {
  readonly packageName: string;
  readonly sourceType: string;
  readonly parserId: string;
}): Record<string, unknown> {
  const envelope = validEnvelope();
  Object.assign(envelope.sourceEvidence as Record<string, unknown>, {
    packageName: input.packageName,
    sourceType: input.sourceType,
  });
  Object.assign(envelope.parser as Record<string, unknown>, {
    parserId: input.parserId,
    parserVersion: "1.0.0",
  });
  return envelope;
}

describe("Firebase Capture envelope inbound adapter", () => {
  it("capture-envelope.v1만 손실 없이 decode하고 등록 package·parser 조합을 허용한다", () => {
    const decoded = decodeCaptureEnvelope(validEnvelope());

    expect(decoded).toMatchObject({
      contractVersion: "capture-envelope.v1",
      observationId: "observation-1",
      paymentObservation: {
        amountInWon: 12_000,
        cardEvidence: { companyLabel: "국민", maskedToken: "1234" },
      },
    });
    expect(validateAndroidCaptureSource(decoded)).toMatchObject({
      kind: "allowed",
      entry: { sourceType: "kb-card", parserId: "kb-card-parser" },
    });
  });

  it("알 수 없는 wire 필드와 불완전한 승인 시각을 조용히 버리지 않는다", () => {
    expect(() =>
      decodeCaptureEnvelope({ ...validEnvelope(), householdId: "wire-house" }),
    ).toThrowError(
      expect.objectContaining({
        code: "UNKNOWN_FIELD",
        path: "$.householdId",
      }),
    );

    const input = validEnvelope();
    const payment = input.paymentObservation as Record<string, unknown>;
    delete payment.occurredLocalTime;
    expect(() => decodeCaptureEnvelope(input)).toThrowError(
      expect.objectContaining({
        code: "OCCURRED_DATE_TIME_INVALID",
      }),
    );
  });

  it("미등록 package, parser 위조, 카드 없는 일반 결제를 각각 terminal 정책 위반으로 구분한다", () => {
    const unsupported = validEnvelope();
    (unsupported.sourceEvidence as Record<string, unknown>).packageName =
      "com.example.unregistered";
    expect(
      validateAndroidCaptureSource(decodeCaptureEnvelope(unsupported)),
    ).toEqual({ kind: "rejected", code: "UNSUPPORTED_SOURCE" });

    const forged = validEnvelope();
    (forged.parser as Record<string, unknown>).parserVersion = "99.0.0";
    expect(validateAndroidCaptureSource(decodeCaptureEnvelope(forged))).toEqual({
      kind: "rejected",
      code: "SOURCE_EVIDENCE_MISMATCH",
    });

    const cardless = validEnvelope();
    delete (cardless.paymentObservation as Record<string, unknown>).cardEvidence;
    expect(
      validateAndroidCaptureSource(decodeCaptureEnvelope(cardless)),
    ).toEqual({ kind: "rejected", code: "CARD_EVIDENCE_REQUIRED" });

    const forgedKakaoBill = validEnvelope();
    Object.assign(
      forgedKakaoBill.sourceEvidence as Record<string, unknown>,
      {
        sourceType: "kakao-talk-financial-message",
        packageName: "com.kakao.talk",
      },
    );
    Object.assign(forgedKakaoBill.parser as Record<string, unknown>, {
      parserId: "kakao-talk-financial-message-parser",
      parserVersion: "1.0.0",
    });
    delete (forgedKakaoBill.paymentObservation as Record<string, unknown>)
      .cardEvidence;
    expect(
      validateAndroidCaptureSource(decodeCaptureEnvelope(forgedKakaoBill)),
    ).toEqual({ kind: "rejected", code: "CARD_EVIDENCE_REQUIRED" });

    const queuedLegacyKakaoBill = legacyKakaoBillEnvelope();
    expect(
      validateAndroidCaptureSource(decodeCaptureEnvelope(queuedLegacyKakaoBill)),
    ).toMatchObject({
      kind: "allowed",
      entry: {
        packageName: "com.kakao.talk",
        sourceType: "kakao-talk-financial-message",
      },
    });
    (queuedLegacyKakaoBill.parser as Record<string, unknown>).parserVersion =
      "1.0.1";
    expect(
      validateAndroidCaptureSource(decodeCaptureEnvelope(queuedLegacyKakaoBill)),
    ).toEqual({ kind: "rejected", code: "SOURCE_EVIDENCE_MISMATCH" });
  });

  it.each([
    ["취소", (payment: Record<string, unknown>) => {
      payment.observationType = "cancellation";
    }],
    ["카드 증거 혼합", (payment: Record<string, unknown>) => {
      payment.cardEvidence = { companyLabel: "삼성", maskedToken: "8481" };
    }],
    ["청구일 불일치", (payment: Record<string, unknown>) => {
      payment.dueDate = "2026-07-22";
    }],
    ["가맹점 형식 불일치", (payment: Record<string, unknown>) => {
      payment.merchantEvidence = { rawCandidate: "도시가스" };
    }],
    ["지역화폐 혼합", (payment: Record<string, unknown>) => {
      payment.localCurrencyType = "gyeonggi";
    }],
  ] as const)(
    "구버전 카카오 도시가스 alias는 %s 형태를 허용하지 않는다",
    (_label, mutate) => {
      const queued = legacyKakaoBillEnvelope();
      mutate(queued.paymentObservation as Record<string, unknown>);

      expect(validateAndroidCaptureSource(decodeCaptureEnvelope(queued))).toEqual({
        kind: "rejected",
        code: "SOURCE_EVIDENCE_MISMATCH",
      });
    },
  );

  it("구버전 카카오 도시가스 alias는 balance가 섞인 envelope를 허용하지 않는다", () => {
    const queued = legacyKakaoBillEnvelope();
    queued.balanceObservation = {
      branchId: "legacy-kakao-balance",
      currencyType: "gyeonggi",
      balanceInWon: 10_000,
      observedAt: "2026-07-21T10:05:01+09:00",
    };

    expect(validateAndroidCaptureSource(decodeCaptureEnvelope(queued))).toEqual({
      kind: "rejected",
      code: "SOURCE_EVIDENCE_MISMATCH",
    });
  });

  it.each([
    [
      "com.google.android.apps.messaging",
      "sms-card-message",
      "sms-card-message-parser",
    ],
    [
      "com.samsung.android.messaging",
      "sms-card-message",
      "sms-card-message-parser",
    ],
    ["com.android.mms", "sms-card-message", "sms-card-message-parser"],
    ["com.samsung.android.spay", "samsung-card", "samsung-card-parser"],
    ["kr.co.samsungcard.mpocket", "samsung-card", "samsung-card-parser"],
  ] as const)(
    "%s에서 이미 생성된 parser 1.0.0 카드 envelope는 1.1.0 registry 전환 후에도 허용한다",
    (packageName, sourceType, parserId) => {
      const queued = legacySamsungSemanticEnvelope({
        packageName,
        sourceType,
        parserId,
      });

      expect(validateAndroidCaptureSource(decodeCaptureEnvelope(queued))).toMatchObject({
        kind: "allowed",
        entry: { packageName, sourceType, parserId, parserVersion: "1.1.0" },
      });
    },
  );

  it("구버전 삼성/SMS parser alias는 카드 증거와 정확한 parser version을 요구한다", () => {
    const cardless = legacySamsungSemanticEnvelope({
      packageName: "com.samsung.android.messaging",
      sourceType: "sms-card-message",
      parserId: "sms-card-message-parser",
    });
    delete (cardless.paymentObservation as Record<string, unknown>).cardEvidence;
    expect(validateAndroidCaptureSource(decodeCaptureEnvelope(cardless))).toEqual({
      kind: "rejected",
      code: "CARD_EVIDENCE_REQUIRED",
    });

    const wrongVersion = legacySamsungSemanticEnvelope({
      packageName: "com.samsung.android.messaging",
      sourceType: "sms-card-message",
      parserId: "sms-card-message-parser",
    });
    (wrongVersion.parser as Record<string, unknown>).parserVersion = "0.9.0";
    expect(validateAndroidCaptureSource(decodeCaptureEnvelope(wrongVersion))).toEqual({
      kind: "rejected",
      code: "SOURCE_EVIDENCE_MISMATCH",
    });
  });
});

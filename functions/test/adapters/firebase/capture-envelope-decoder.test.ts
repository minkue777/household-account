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
  });
});

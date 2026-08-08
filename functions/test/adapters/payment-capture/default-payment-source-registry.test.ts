import { describe, expect, it } from "vitest";

import { ANDROID_PAYMENT_SOURCE_REGISTRY } from "../../../src/contexts/payment-capture/android-payment-ingestion/domain/model/defaultPaymentSourceRegistry";

describe("기본 Android 결제 source registry", () => {
  it("카카오톡 package는 복합 금융 메시지 parser 한 항목에만 등록한다", () => {
    expect(
      ANDROID_PAYMENT_SOURCE_REGISTRY.filter(
        (entry) => entry.packageName === "com.kakao.talk",
      ),
    ).toEqual([
      expect.objectContaining({
        sourceType: "kakao-talk-financial-message",
        parserId: "kakao-talk-financial-message-parser",
        parserVersion: "1.0.0",
        supportsCityGasBill: true,
      }),
    ]);
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
    "%s의 삼성 승인 취소 의미 변경을 parser 1.1.0으로 표시한다",
    (packageName, sourceType, parserId) => {
      expect(
        ANDROID_PAYMENT_SOURCE_REGISTRY.filter(
          (entry) => entry.packageName === packageName,
        ),
      ).toEqual([
        expect.objectContaining({
          sourceType,
          parserId,
          parserVersion: "1.1.0",
        }),
      ]);
    },
  );
});

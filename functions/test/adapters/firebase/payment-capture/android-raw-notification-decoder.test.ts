import { describe, expect, it } from "vitest";

import {
  AndroidRawNotificationValidationError,
  decodeAndroidRawNotification,
} from "../../../../src/adapters/firebase/payment-capture/androidRawNotificationDecoder";

function validInput() {
  return {
    contractVersion: "android-raw-notification.v1",
    observationId: "observation.android.raw-1",
    packageName: "com.samsung.android.messaging",
    notification: {
      postedAt: "2026-07-22T17:41:00+09:00",
      title: "문자 메시지",
      textLines: ["[Web발신]", "삼성1876승인 이*선"],
    },
  };
}

describe("Android raw notification Firebase decoder", () => {
  it("클라이언트가 출처·파서·가구 정보를 주입할 수 없도록 알 수 없는 필드를 거부한다", () => {
    for (const field of ["parserId", "sourceType", "householdId", "createdBy"]) {
      expect(() =>
        decodeAndroidRawNotification({ ...validInput(), [field]: "spoofed" }),
      ).toThrowError(
        expect.objectContaining<Partial<AndroidRawNotificationValidationError>>({
          code: "UNKNOWN_FIELD",
          path: `$.${field}`,
        }),
      );
    }
  });

  it("유효한 등록 패키지 원문 구조만 정규화한다", () => {
    expect(decodeAndroidRawNotification(validInput())).toEqual(validInput());
  });

  it("전체 원문 크기와 textLines 개수를 제한한다", () => {
    expect(() =>
      decodeAndroidRawNotification({
        ...validInput(),
        notification: {
          ...validInput().notification,
          bigText: "가".repeat(65_000),
          text: "나".repeat(1_000),
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "NOTIFICATION_TOO_LARGE" }),
    );
    expect(() =>
      decodeAndroidRawNotification({
        ...validInput(),
        notification: {
          postedAt: "2026-07-22T17:41:00+09:00",
          textLines: Array.from({ length: 33 }, () => "line"),
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "TEXT_LINES_INVALID" }));
  });
});

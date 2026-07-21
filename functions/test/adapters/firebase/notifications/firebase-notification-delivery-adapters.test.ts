import { describe, expect, it } from "vitest";

import { classifyFirebaseMessagingError } from "../../../../src/adapters/firebase/notifications/firebaseNotificationDeliveryAdapters";

describe("Firebase FID provider outcome classification", () => {
  it("404 UNREGISTERED만 영구 endpoint 실패로 분류할 수 있게 보존한다", () => {
    expect(
      classifyFirebaseMessagingError({
        code: "messaging/registration-token-not-registered",
        message: "UNREGISTERED",
      }),
    ).toEqual({ kind: "http-error", httpStatus: 404, code: "UNREGISTERED" });
  });

  it("quota, credential, timeout과 일시 네트워크 실패를 구분한다", () => {
    expect(classifyFirebaseMessagingError({ code: "messaging/quota-exceeded" })).toEqual({
      kind: "quota",
    });
    expect(
      classifyFirebaseMessagingError({ code: "messaging/authentication-error" }),
    ).toEqual({ kind: "credential-error" });
    expect(classifyFirebaseMessagingError({ message: "request timeout" })).toEqual({
      kind: "timeout",
    });
    expect(classifyFirebaseMessagingError(new Error("connection reset"))).toEqual({
      kind: "network-error",
    });
  });
});

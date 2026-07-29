import { describe, expect, it } from "vitest";

import {
  householdNotificationDeliveryLatencyStatus,
  shortcutNotificationDeliveryLatencyStatus,
} from "../../src/bootstrap/notificationOutboxLatency";

describe("notification Outbox latency outcome", () => {
  it("모든 endpoint가 FCM에 접수된 경우에만 성공으로 집계한다", () => {
    expect(
      householdNotificationDeliveryLatencyStatus({
        kind: "Queued",
        deliveryResults: [{ kind: "Delivered" }, { kind: "Delivered" }],
      }),
    ).toBe("succeeded");

    expect(
      householdNotificationDeliveryLatencyStatus({
        kind: "Queued",
        deliveryResults: [
          { kind: "Delivered" },
          { kind: "Failed", code: "PROVIDER_NETWORK_ERROR" },
        ],
      }),
    ).toBe("failed");
  });

  it("대상 없음과 만료는 FCM 접수 성공으로 세지 않는다", () => {
    expect(
      householdNotificationDeliveryLatencyStatus({ kind: "NoTarget" }),
    ).toBe("rejected");
    expect(
      householdNotificationDeliveryLatencyStatus({ kind: "ExpiredEvent" }),
    ).toBe("rejected");
    expect(
      householdNotificationDeliveryLatencyStatus({
        kind: "AlreadyProcessed",
        deliveryResults: [],
      }),
    ).toBe("failed");
  });

  it("iPhone 수정 알림도 FCM 접수 결과로 성공과 실패를 구분한다", () => {
    expect(
      shortcutNotificationDeliveryLatencyStatus({
        kind: "Delivered",
        transactionId: "transaction-a",
      }),
    ).toBe("succeeded");
    expect(
      shortcutNotificationDeliveryLatencyStatus({
        kind: "UnknownProviderOutcome",
        transactionId: "transaction-a",
      }),
    ).toBe("failed");
  });
});

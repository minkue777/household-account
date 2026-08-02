import { describe, expect, it } from "vitest";

import {
  householdNotificationDeliveryLatencyStatus,
  notificationOutboxConsumerAlreadyTerminal,
  shortcutNotificationDeliveryLatencyStatus,
} from "../../src/bootstrap/notificationOutboxLatency";

describe("notification Outbox latency outcome", () => {
  it("이미 terminal 처리한 Outbox event는 재전달 대상에서 제외한다", () => {
    expect(notificationOutboxConsumerAlreadyTerminal({})).toBe(false);
    expect(notificationOutboxConsumerAlreadyTerminal({
      notificationConsumerProcessedAt: "2026-08-02T13:00:00.000Z",
    })).toBe(true);
    expect(notificationOutboxConsumerAlreadyTerminal({
      terminalAt: "2026-08-02T13:00:00.000Z",
    })).toBe(true);
  });

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
        kind: "NoTarget",
        transactionId: "transaction-a",
        reason: "NO_ACTIVE_ENDPOINT",
      }),
    ).toBe("rejected");
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

import { describe, expect, it } from "vitest";

import {
  notificationOutboxConsumerAlreadyTerminal,
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

});

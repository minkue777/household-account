import { describe, expect, it } from "vitest";

import {
  summarizeInteractiveLatency,
  type InteractiveLatencyObservation,
} from "../../src/adapters/google-cloud/admin/googleCloudInteractiveLatencyReader";

describe("Google Cloud interactive latency reader", () => {
  it("aggregates Cloud Function totals by endpoint and operation", () => {
    const observations: InteractiveLatencyObservation[] = [
      {
        endpoint: "executeHouseholdCommand",
        operation: "ledger.transaction.update.v1",
        elapsedMs: 100,
        status: "succeeded",
        timestamp: "2026-07-28T00:00:00.000Z",
      },
      {
        endpoint: "executeHouseholdCommand",
        operation: "ledger.transaction.update.v1",
        elapsedMs: 200,
        status: "succeeded",
        timestamp: "2026-07-28T00:01:00.000Z",
      },
      {
        endpoint: "executeHouseholdCommand",
        operation: "ledger.transaction.update.v1",
        elapsedMs: 400,
        status: "failed",
        timestamp: "2026-07-28T00:02:00.000Z",
      },
      {
        endpoint: "executeHouseholdQuery",
        operation: "portfolio.market-data.search.v1",
        elapsedMs: 50,
        status: "succeeded",
        timestamp: "2026-07-28T00:03:00.000Z",
      },
      {
        endpoint: "addExpenseFromMessage",
        operation: "payment-capture.submit-ios-shortcut-message.v1",
        elapsedMs: 75,
        status: "succeeded",
        timestamp: "2026-07-28T00:04:00.000Z",
      },
    ];

    expect(summarizeInteractiveLatency(observations)).toEqual([
      {
        endpoint: "executeHouseholdCommand",
        operation: "ledger.transaction.update.v1",
        sampleCount: 3,
        succeededCount: 2,
        failedCount: 1,
        averageMs: 233.3,
        p95Ms: 400,
        maxMs: 400,
        latestAt: "2026-07-28T00:02:00.000Z",
      },
      {
        endpoint: "addExpenseFromMessage",
        operation: "payment-capture.submit-ios-shortcut-message.v1",
        sampleCount: 1,
        succeededCount: 1,
        failedCount: 0,
        averageMs: 75,
        p95Ms: 75,
        maxMs: 75,
        latestAt: "2026-07-28T00:04:00.000Z",
      },
      {
        endpoint: "executeHouseholdQuery",
        operation: "portfolio.market-data.search.v1",
        sampleCount: 1,
        succeededCount: 1,
        failedCount: 0,
        averageMs: 50,
        p95Ms: 50,
        maxMs: 50,
        latestAt: "2026-07-28T00:03:00.000Z",
      },
    ]);
  });
});

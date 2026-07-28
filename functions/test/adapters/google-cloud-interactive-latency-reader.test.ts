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

  it("drops samples before each split operation's latest measurement baseline", () => {
    const remeasuredOperations = [
      "ledger.split-existing-transaction-monthly.v1",
      "ledger.cancel-monthly-split.v1",
    ] as const;
    const observations: InteractiveLatencyObservation[] = remeasuredOperations.flatMap(
      (operation) => [
        {
          endpoint: "executeHouseholdCommand",
          operation,
          elapsedMs: 20_000,
          status: "succeeded",
          timestamp: "2026-07-28T15:10:23.000Z",
        },
        {
          endpoint: "executeHouseholdCommand",
          operation,
          elapsedMs: 300,
          status: "succeeded",
          timestamp: "2026-07-28T15:10:25.000Z",
        },
      ],
    );
    observations.push(
      {
        endpoint: "executeHouseholdCommand",
        operation: "ledger.split-transaction.v1",
        elapsedMs: 310,
        status: "succeeded",
        timestamp: "2026-07-28T14:28:01.000Z",
      },
    );

    const summary = summarizeInteractiveLatency(observations);
    expect(summary).toHaveLength(3);
    expect(summary).toEqual(
      expect.arrayContaining(remeasuredOperations.map((operation) => ({
        endpoint: "executeHouseholdCommand",
        operation,
        sampleCount: 1,
        succeededCount: 1,
        failedCount: 0,
        averageMs: 300,
        p95Ms: 300,
        maxMs: 300,
        latestAt: "2026-07-28T15:10:25.000Z",
      }))),
    );
    expect(summary).toContainEqual({
      endpoint: "executeHouseholdCommand",
      operation: "ledger.split-transaction.v1",
      sampleCount: 1,
      succeededCount: 1,
      failedCount: 0,
      averageMs: 310,
      p95Ms: 310,
      maxMs: 310,
      latestAt: "2026-07-28T14:28:01.000Z",
    });
  });
});

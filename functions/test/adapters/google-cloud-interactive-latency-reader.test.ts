import { describe, expect, it } from "vitest";

import {
  GoogleCloudInteractiveLatencyReader,
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

  it("drops pre-fix market refresh rejections from the admin failure count", () => {
    const operation = "portfolio.refresh-market-values.v1";
    const summary = summarizeInteractiveLatency([
      {
        endpoint: "executeHouseholdCommand",
        operation,
        elapsedMs: 120,
        status: "rejected",
        timestamp: "2026-07-29T10:45:28.394Z",
      },
      {
        endpoint: "executeHouseholdCommand",
        operation,
        elapsedMs: 180,
        status: "succeeded",
        timestamp: "2026-07-29T10:45:28.396Z",
      },
    ]);

    expect(summary).toEqual([
      {
        endpoint: "executeHouseholdCommand",
        operation,
        sampleCount: 1,
        succeededCount: 1,
        failedCount: 0,
        averageMs: 180,
        p95Ms: 180,
        maxMs: 180,
        latestAt: "2026-07-29T10:45:28.396Z",
      },
    ]);
  });

  it("사용자 체감과 무관한 요청 저장·관리자 보조 조회를 제외하고 실제 FCM 접수 시간을 집계한다", () => {
    const summary = summarizeInteractiveLatency([
      {
        endpoint: "executeHouseholdCommand",
        operation: "ledger.request-notification.v1",
        elapsedMs: 90,
        status: "succeeded",
        timestamp: "2026-07-29T12:00:00.000Z",
      },
      {
        endpoint: "executeHouseholdQuery",
        operation: "access.list-asset-owner-profiles.v1",
        elapsedMs: 140,
        status: "succeeded",
        timestamp: "2026-07-29T12:00:00.500Z",
      },
      {
        endpoint: "consumeNotificationOutbox",
        operation: "notifications.deliver-household-request.v1",
        elapsedMs: 1_250,
        status: "succeeded",
        timestamp: "2026-07-29T12:00:01.000Z",
      },
    ]);

    expect(summary).toEqual([
      {
        endpoint: "consumeNotificationOutbox",
        operation: "notifications.deliver-household-request.v1",
        sampleCount: 1,
        succeededCount: 1,
        failedCount: 0,
        averageMs: 1_250,
        p95Ms: 1_250,
        maxMs: 1_250,
        latestAt: "2026-07-29T12:00:01.000Z",
      },
    ]);
  });

  it("알림 재시도는 correlation별 최종 결과만 세고 실제 provider 성공 시간만 지연값에 반영한다", () => {
    const operation = "notifications.deliver-ios-shortcut.v1";
    const summary = summarizeInteractiveLatency([
      {
        correlationId: "event-a",
        endpoint: "consumeNotificationOutbox",
        operation,
        elapsedMs: 20_000,
        status: "failed",
        timestamp: "2026-08-02T14:00:00.000Z",
      },
      {
        correlationId: "event-a",
        endpoint: "consumeNotificationOutbox",
        operation,
        elapsedMs: 8_000,
        status: "failed",
        timestamp: "2026-08-02T14:01:00.000Z",
      },
      {
        correlationId: "event-a",
        endpoint: "consumeNotificationOutbox",
        operation,
        elapsedMs: 1_250,
        status: "succeeded",
        timestamp: "2026-08-02T14:02:00.000Z",
      },
      {
        correlationId: "event-b",
        endpoint: "consumeNotificationOutbox",
        operation,
        elapsedMs: 900,
        status: "failed",
        timestamp: "2026-08-02T14:03:00.000Z",
      },
      {
        correlationId: "event-without-target",
        endpoint: "consumeNotificationOutbox",
        operation,
        elapsedMs: 100,
        status: "rejected",
        timestamp: "2026-08-02T14:04:00.000Z",
      },
    ]);

    expect(summary).toEqual([
      {
        endpoint: "consumeNotificationOutbox",
        operation,
        sampleCount: 2,
        succeededCount: 1,
        failedCount: 1,
        averageMs: 1_250,
        p95Ms: 1_250,
        maxMs: 1_250,
        latestAt: "2026-08-02T14:03:00.000Z",
      },
    ]);
  });

  it("알림 provider 성공 표본이 없으면 실패 건수는 보존하고 지연값은 0으로 표시한다", () => {
    const summary = summarizeInteractiveLatency([
      {
        correlationId: "failed-event",
        endpoint: "consumeNotificationOutbox",
        operation: "notifications.deliver-household-request.v1",
        elapsedMs: 3_500,
        status: "failed",
        timestamp: "2026-08-02T10:00:00.000Z",
      },
    ]);

    expect(summary).toEqual([
      {
        endpoint: "consumeNotificationOutbox",
        operation: "notifications.deliver-household-request.v1",
        sampleCount: 1,
        succeededCount: 0,
        failedCount: 1,
        averageMs: 0,
        p95Ms: 0,
        maxMs: 0,
        latestAt: "2026-08-02T10:00:00.000Z",
      },
    ]);
  });

  it("알림 대상 없음으로 거부된 요청은 provider 호출 지표에서 제외한다", () => {
    expect(summarizeInteractiveLatency([
      {
        correlationId: "event-without-target",
        endpoint: "consumeNotificationOutbox",
        operation: "notifications.deliver-household-request.v1",
        elapsedMs: 100,
        status: "rejected",
        timestamp: "2026-08-02T10:00:00.000Z",
      },
    ])).toEqual([]);
  });

  it("같은 correlation을 공유해도 서로 다른 endpoint와 operation은 각각 보존한다", () => {
    const summary = summarizeInteractiveLatency([
      {
        correlationId: "shared-correlation",
        endpoint: "executeHouseholdCommand",
        operation: "ledger.update-transaction.v1",
        elapsedMs: 120,
        status: "succeeded",
        timestamp: "2026-08-02T10:00:00.000Z",
      },
      {
        correlationId: "shared-correlation",
        endpoint: "consumeNotificationOutbox",
        operation: "notifications.deliver-household-request.v1",
        elapsedMs: 450,
        status: "succeeded",
        timestamp: "2026-08-02T10:00:01.000Z",
      },
    ]);

    expect(summary).toHaveLength(2);
    expect(summary.map(({ endpoint, operation }) => ({ endpoint, operation })))
      .toEqual(expect.arrayContaining([
        {
          endpoint: "executeHouseholdCommand",
          operation: "ledger.update-transaction.v1",
        },
        {
          endpoint: "consumeNotificationOutbox",
          operation: "notifications.deliver-household-request.v1",
        },
      ]));
  });

  it("Cloud Logging correlationId를 읽어 같은 Outbox event의 재시도를 한 건으로 축약한다", async () => {
    const reader = new GoogleCloudInteractiveLatencyReader(
      "project-a",
      {
        getAccessToken: async () => ({ access_token: "token-a" }),
      },
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          entries: [
            {
              timestamp: "2026-08-02T14:01:00.000Z",
              jsonPayload: {
                correlationId: "same-outbox-event",
                endpoint: "consumeNotificationOutbox",
                operation: "notifications.deliver-ios-shortcut.v1",
                elapsedMs: 700,
                status: "succeeded",
              },
            },
            {
              timestamp: "2026-08-02T14:00:00.000Z",
              jsonPayload: {
                correlationId: "same-outbox-event",
                endpoint: "consumeNotificationOutbox",
                operation: "notifications.deliver-ios-shortcut.v1",
                elapsedMs: 10_000,
                status: "failed",
              },
            },
          ],
        }),
      }),
    );

    const result = await reader.read({
      generatedAt: "2026-08-02T15:00:00.000Z",
      windowHours: 24,
    });

    expect(result.operations).toEqual([
      {
        endpoint: "consumeNotificationOutbox",
        operation: "notifications.deliver-ios-shortcut.v1",
        sampleCount: 1,
        succeededCount: 1,
        failedCount: 0,
        averageMs: 700,
        p95Ms: 700,
        maxMs: 700,
        latestAt: "2026-08-02T14:01:00.000Z",
      },
    ]);
  });

  it("Android·iPhone 첫 화면과 긴 Outbox 대기를 허용 endpoint로 읽는다", async () => {
    const reader = new GoogleCloudInteractiveLatencyReader(
      "project-a",
      {
        getAccessToken: async () => ({ access_token: "token-a" }),
      },
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          entries: [
            {
              timestamp: "2026-08-02T14:00:00.000Z",
              jsonPayload: {
                endpoint: "clientStartup",
                operation: "client.android-app-first-home-complete-paint.v1",
                elapsedMs: 3_450,
                status: "succeeded",
              },
            },
            {
              timestamp: "2026-08-02T14:00:00.500Z",
              jsonPayload: {
                endpoint: "clientStartup",
                operation: "client.ios-pwa-first-home-complete-paint.v1",
                elapsedMs: 2_850,
                status: "succeeded",
              },
            },
            {
              timestamp: "2026-08-02T14:00:00.750Z",
              jsonPayload: {
                endpoint: "createWebViewSessionToken",
                operation: "access.create-webview-session-token.v1",
                elapsedMs: 450,
                status: "succeeded",
              },
            },
            {
              timestamp: "2026-08-02T14:00:01.000Z",
              jsonPayload: {
                endpoint: "consumeNotificationOutbox",
                operation: "notifications.deliver-ios-shortcut.v1",
                elapsedMs: 15 * 60 * 1_000,
                status: "succeeded",
              },
            },
          ],
        }),
      }),
    );

    const result = await reader.read({
      generatedAt: "2026-08-02T15:00:00.000Z",
      windowHours: 24,
    });

    expect(result.operations.map(({ endpoint, operation }) => ({
      endpoint,
      operation,
    }))).toEqual([
      {
        endpoint: "consumeNotificationOutbox",
        operation: "notifications.deliver-ios-shortcut.v1",
      },
      {
        endpoint: "clientStartup",
        operation: "client.android-app-first-home-complete-paint.v1",
      },
      {
        endpoint: "clientStartup",
        operation: "client.ios-pwa-first-home-complete-paint.v1",
      },
    ]);
  });
});

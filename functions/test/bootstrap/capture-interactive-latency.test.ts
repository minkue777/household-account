import { describe, expect, it } from "vitest";

import {
  withCaptureConfigurationLatency,
  withCapturePersistenceLatency,
  withCaptureReceiptLatency,
} from "../../src/bootstrap/captureInteractiveLatency";
import {
  setCurrentInteractiveLatencyOperation,
  startInteractiveLatencyInvocation,
  type InteractiveLatencyLogEntry,
} from "../../src/observability/interactiveLatency";

describe("capture interactive latency instrumentation", () => {
  it("receipt/configuration/persistence 포트를 같은 raw notification 호출로 계측한다", async () => {
    const entries: InteractiveLatencyLogEntry[] = [];
    const latency = startInteractiveLatencyInvocation(
      "submitAndroidRawNotification",
      { sink: { write: (entry) => entries.push(entry) } },
    );
    const receipts = withCaptureReceiptLatency({
      claim: async () => ({
        kind: "conflict",
        code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
      }),
      save: async () => undefined,
    });
    const configuration = withCaptureConfigurationLatency({
      load: async () => ({
        kind: "retryable-failure",
        code: "PAYMENT_CONFIGURATION_UNAVAILABLE",
      }),
    });
    const persistence = withCapturePersistenceLatency({
      recordApproval: async () => ({
        kind: "retryable-failure",
        code: "LEDGER_UNAVAILABLE",
      }),
      cancel: async () => ({
        kind: "retryable-failure",
        code: "LEDGER_UNAVAILABLE",
      }),
    });

    await latency.run(async () => {
      setCurrentInteractiveLatencyOperation(
        "payment-capture.submit-android-raw-notification.v1",
      );
      await receipts.claim({
        envelope: {
          rootIdempotencyKey: "observation-sensitive",
          householdId: "household-sensitive",
        },
        payloadFingerprint: "payload-sensitive",
      });
      await receipts.save({
        householdId: "household-sensitive",
        rootIdempotencyKey: "observation-sensitive",
        payloadFingerprint: "payload-sensitive",
        state: "claimed",
        transaction: { stage: "absent" },
        balance: { stage: "absent" },
      });
      await configuration.load({
        householdId: "household-sensitive",
        actingMemberId: "member-sensitive",
      });
      await persistence.cancel({
        householdId: "household-sensitive",
        downstreamKey: "downstream-sensitive",
        branch: {
          observationId: "observation-sensitive",
          creatorMemberId: "member-sensitive",
          sourceType: "payment",
          parser: { parserId: "parser", parserVersion: "1" },
          rawPayloadHash: "payload-sensitive",
          observedAt: "2026-07-23T10:00:00+09:00",
          cancellationDate: "2026-07-23",
          amountInWon: 987_654_321,
          merchant: "민감 가맹점",
        },
      });
      latency.complete("succeeded");
    });

    expect(entries.map((entry) => entry.stage)).toEqual([
      "capture-receipt-claim",
      "capture-receipt-save",
      "capture-configuration",
      "capture-persistence",
      "total",
    ]);
    expect(
      new Set(entries.map((entry) => entry.correlationId)),
    ).toEqual(new Set([latency.correlationId]));
    expect(
      new Set(entries.map((entry) => entry.operation)),
    ).toEqual(
      new Set(["payment-capture.submit-android-raw-notification.v1"]),
    );
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("household-sensitive");
    expect(serialized).not.toContain("member-sensitive");
    expect(serialized).not.toContain("민감 가맹점");
    expect(serialized).not.toContain("amountInWon");
    expect(serialized).not.toContain("987654321");
  });
});

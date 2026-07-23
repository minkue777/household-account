import { logger } from "firebase-functions";
import { describe, expect, it, vi } from "vitest";

import {
  measureCurrentInteractiveLatency,
  setCurrentInteractiveLatencyOperation,
  startInteractiveLatencyInvocation,
  type InteractiveLatencyLogEntry,
} from "../../src/observability/interactiveLatency";

function memorySink() {
  const entries: InteractiveLatencyLogEntry[] = [];
  return {
    entries,
    sink: { write: (entry: InteractiveLatencyLogEntry) => entries.push(entry) },
  };
}

describe("interactive latency telemetry", () => {
  it("같은 invocation의 단계 시간을 correlation과 process 식별자로 묶는다", async () => {
    let now = 100;
    const logs = memorySink();
    const first = startInteractiveLatencyInvocation(
      "executeHouseholdCommand",
      {
        clock: { now: () => now },
        sink: logs.sink,
      },
    );

    await first.run(async () => {
      setCurrentInteractiveLatencyOperation(
        "ledger.record-manual-transaction.v1",
      );
      await measureCurrentInteractiveLatency("actor-membership", () => {
        now += 12.345;
        return { kind: "active" };
      });
      await measureCurrentInteractiveLatency("handler", async () => {
        now += 7;
      });
      first.complete("succeeded");
    });

    expect(logs.entries.map(({ stage, elapsedMs }) => ({ stage, elapsedMs })))
      .toEqual([
        { stage: "actor-membership", elapsedMs: 12.345 },
        { stage: "handler", elapsedMs: 7 },
        { stage: "total", elapsedMs: 19.345 },
      ]);
    expect(
      new Set(logs.entries.map((entry) => entry.correlationId)),
    ).toEqual(new Set([first.correlationId]));
    expect(
      new Set(logs.entries.map((entry) => entry.operation)),
    ).toEqual(new Set(["ledger.record-manual-transaction.v1"]));
    expect(logs.entries[0]).toMatchObject({
      schemaVersion: "interactive-latency.v1",
      endpoint: "executeHouseholdCommand",
      revision: expect.any(String),
      processBootId: expect.any(String),
      invocationSequence: expect.any(Number),
      status: "succeeded",
    });
  });

  it("같은 process의 호출 순번은 증가하고 boot 식별자는 유지한다", async () => {
    const logs = memorySink();
    const first = startInteractiveLatencyInvocation("executeHouseholdQuery", {
      sink: logs.sink,
    });
    const second = startInteractiveLatencyInvocation(
      "submitAndroidRawNotification",
      { sink: logs.sink },
    );

    first.complete("rejected");
    second.complete("failed");

    const [firstEntry, secondEntry] = logs.entries;
    expect(secondEntry.invocationSequence).toBe(
      firstEntry.invocationSequence + 1,
    );
    expect(secondEntry.processBootId).toBe(firstEntry.processBootId);
    expect(secondEntry.correlationId).not.toBe(firstEntry.correlationId);
    expect(logs.entries.map((entry) => entry.status)).toEqual([
      "rejected",
      "failed",
    ]);
  });

  it("구조화 로그는 allowlist 필드만 기록하고 요청 원문·가구·금액을 포함하지 않는다", async () => {
    const logs = memorySink();
    const latency = startInteractiveLatencyInvocation(
      "submitAndroidRawNotification",
      { sink: logs.sink },
    );
    const sensitiveRequest = {
      principalUid: "uid-sensitive",
      householdId: "household-sensitive",
      rawText: "카드 승인 원문",
      amountInWon: 987_654_321,
    };

    await latency.run(async () => {
      setCurrentInteractiveLatencyOperation(
        "payment-capture.submit-android-raw-notification.v1",
      );
      await measureCurrentInteractiveLatency("handler", () =>
        Object.keys(sensitiveRequest),
      );
      latency.complete("succeeded");
    });

    const allowedKeys = [
      "correlationId",
      "elapsedMs",
      "endpoint",
      "invocationSequence",
      "operation",
      "processBootId",
      "revision",
      "schemaVersion",
      "stage",
      "status",
    ];
    for (const entry of logs.entries) {
      expect(Object.keys(entry).sort()).toEqual(allowedKeys);
    }
    const serialized = JSON.stringify(logs.entries);
    expect(serialized).not.toContain("uid-sensitive");
    expect(serialized).not.toContain("household-sensitive");
    expect(serialized).not.toContain("카드 승인 원문");
    expect(serialized).not.toContain("amountInWon");
    expect(serialized).not.toContain("987654321");
  });

  it("로그 출력 실패가 요청 결과를 바꾸지 않는다", async () => {
    const latency = startInteractiveLatencyInvocation(
      "executeHouseholdQuery",
      {
        sink: {
          write() {
            throw new Error("LOG_SINK_UNAVAILABLE");
          },
        },
      },
    );

    await expect(
      latency.run(() =>
        measureCurrentInteractiveLatency("handler", async () => "response"),
      ),
    ).resolves.toBe("response");
    expect(() => latency.complete("succeeded")).not.toThrow();
  });

  it("기본 sink는 emulator에서도 보이는 Firebase 구조화 logger를 사용한다", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const latency = startInteractiveLatencyInvocation(
      "executeHouseholdCommand",
    );

    await latency.run(() =>
      measureCurrentInteractiveLatency("handler", async () => undefined),
    );
    latency.complete("succeeded");

    expect(info).toHaveBeenCalledWith(
      "interactive-latency",
      expect.objectContaining({
        schemaVersion: "interactive-latency.v1",
        endpoint: "executeHouseholdCommand",
        stage: "handler",
        elapsedMs: expect.any(Number),
      }),
    );
  });
});

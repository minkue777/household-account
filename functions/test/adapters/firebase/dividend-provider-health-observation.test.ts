import type * as firestore from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FirebaseDividendProviderObservation } from "../../../src/adapters/firebase/dividends/firebaseDividendProviderObservation";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

vi.mock("firebase-functions", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("EXT-001 실제 KIND 관측 저장소와 Cloud Monitoring 전이 로그", () => {
  it("부분 실패는 degraded, 전체 실패 3회는 open, 부분 복구는 동일 경보 resolve이며 replay가 중복 경보를 만들지 않는다", async () => {
    const channel = "projects/test/notificationChannels/provider-email";
    vi.stubEnv("CLOUD_MONITORING_NOTIFICATION_CHANNEL", channel);
    const memory = new InMemoryFirestore();
    const observations = new FirebaseDividendProviderObservation(memory as unknown as firestore.Firestore);
    const finish = async (sequence: number, partialSuccess: boolean) => {
      const executionKey = `dividend-hourly:household-secret:${sequence}`;
      const observedAt = `2026-09-0${sequence}T11:00:00+09:00`;
      for (const [index, resultKind] of (partialSuccess ? ["SUCCESS", "CONTRACT_FAILURE"] : ["CONTRACT_FAILURE", "CONTRACT_FAILURE"]).entries()) {
        const input = {
          executionKey, observedAt, targetId: `instrument:private-${index}`,
          resultKind: resultKind as "SUCCESS" | "CONTRACT_FAILURE", attempts: 3,
          ...(resultKind === "CONTRACT_FAILURE" ? { errorCode: "HTTP_STATUS_NOT_SUPPORTED", httpStatus: 403, stage: "search" } : {}),
        };
        await observations.record(input);
        await observations.record(input);
      }
      await observations.finalizeRun({ executionKey, observedAt });
      await observations.finalizeRun({ executionKey, observedAt });
      const healthPath = memory.paths("operations/runtime/providerHealth/")[0];
      return memory.document(healthPath);
    };
    const alertPayloads = () => [...vi.mocked(logger.error).mock.calls, ...vi.mocked(logger.info).mock.calls]
      .filter(([event]) => event === "provider-health-alert" || event === "provider-health-alert-resolved")
      .map(([, payload]) => payload as Record<string, unknown>);

    expect(await finish(1, true)).toMatchObject({ provider: "KIND", operation: "dividend-disclosure", status: "degraded", consecutiveFailedRuns: 0, alertState: "closed", lastRunSucceededTargets: 1, lastRunFailedTargets: 1 });
    expect(alertPayloads()).toHaveLength(0);
    expect(await finish(2, false)).toMatchObject({ status: "degraded", consecutiveFailedRuns: 1, alertState: "closed" });
    expect(await finish(3, false)).toMatchObject({ status: "degraded", consecutiveFailedRuns: 2, alertState: "closed" });
    expect(alertPayloads()).toHaveLength(0);
    expect(await finish(4, false)).toMatchObject({ status: "outage", consecutiveFailedRuns: 3, alertState: "open", lastRunFailedTargets: 2, version: 4 });
    expect(alertPayloads()).toEqual([expect.objectContaining({ eventType: "provider-health-alert-transition", transition: "opened", notificationChannelResource: channel })]);
    expect(await finish(5, true)).toMatchObject({ status: "degraded", consecutiveFailedRuns: 0, alertState: "closed", recoveredAt: "2026-09-05T11:00:00+09:00", version: 5 });
    const alerts = alertPayloads();
    expect(alerts).toHaveLength(2);
    expect(alerts[1]).toMatchObject({ transition: "resolved", alertIdentity: alerts[0].alertIdentity, notificationChannelResource: channel });
    expect(memory.paths("operations/runtime/providerObservationReceipts/")).toHaveLength(10);
    expect(memory.paths("operations/runtime/providerHealthRunReceipts/")).toHaveLength(5);
    const exported = JSON.stringify({ alerts, info: vi.mocked(logger.info).mock.calls, error: vi.mocked(logger.error).mock.calls });
    expect(exported).not.toContain("household-secret");
    expect(exported).not.toContain("instrument:private-");
  });
});

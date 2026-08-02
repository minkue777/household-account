import { describe, expect, it } from "vitest";

import { createDividendScheduledRuntimeApplication } from "../../src/contexts/portfolio/dividends/application/dividendScheduledRuntimeApplication";
import type {
  DividendProviderObservationPort,
  DividendScheduledRuntimeDependencies,
} from "../../src/contexts/portfolio/dividends/application/ports/out/dividendScheduledRuntimePorts";
import type { DividendHoldingTargetView } from "../../src/contexts/portfolio/holdings/public";

function target(code: string): DividendHoldingTargetView {
  return {
    targetId: `household-a:${code}`,
    householdId: "household-a",
    sourceAssetIds: [`asset-${code}`],
    instrument: {
      market: "KRX",
      instrumentType: "ETF",
      code,
      name: `ETF ${code}`,
      currency: "KRW",
    },
  };
}

function dependencies(input: {
  pages: Readonly<Record<string, {
    items: readonly DividendHoldingTargetView[];
    nextCursor?: string;
  }>>;
  observations: DividendProviderObservationPort;
}): DividendScheduledRuntimeDependencies {
  return {
    holdings: {
      async listActiveKrxEtfTargets({ cursor }) {
        return input.pages[cursor ?? "first"] ?? { items: [] };
      },
      async listPositionHistory() {
        return [];
      },
    },
    disclosures: {
      async discover({ instrumentCode }) {
        return instrumentCode === "069500"
          ? {
              kind: "contract-failure" as const,
              code: "HTTP_STATUS_NOT_SUPPORTED",
              attempts: 1,
              httpStatus: 403,
              stage: "search",
            }
          : { kind: "success" as const, disclosures: [], attempts: 1 };
      },
    },
    events: {
      async upsertAnnouncement() {
        throw new Error("no disclosure expected");
      },
      async listNonterminal() {
        return { items: [] };
      },
      async transition() {
        return { kind: "unchanged", code: "not-used" };
      },
      async rebuildAllAnnualProjections() {
        return { projectionCount: 0 };
      },
    },
    providerObservations: input.observations,
  };
}

describe("배당 예약 실행의 KIND Health 집계", () => {
  it("마지막 discovery page에서 모든 종목 결과를 기록한 뒤 실행을 한 번만 종결한다", async () => {
    const recorded: Array<
      Parameters<DividendProviderObservationPort["record"]>[0]
    > = [];
    const finalized: Array<
      Parameters<DividendProviderObservationPort["finalizeRun"]>[0]
    > = [];
    const order: string[] = [];
    const observations: DividendProviderObservationPort = {
      async record(input) {
        recorded.push(input);
        order.push(`record:${input.targetId}`);
      },
      async finalizeRun(input) {
        finalized.push(input);
        order.push("finalize");
      },
    };
    const application = createDividendScheduledRuntimeApplication(
      dependencies({
        pages: { first: { items: [target("102110"), target("069500")] } },
        observations,
      }),
    );

    const result = await application.runDiscoveryPage({
      limit: 50,
      concurrency: 2,
      periodFrom: "2025-08-01",
      periodTo: "2026-08-01",
      executionKey: "dividend-hourly:2026-08-01T11",
      observedAt: "2026-08-01T11:00:00+09:00",
    });

    expect(result.items).toEqual([
      expect.objectContaining({ kind: "succeeded" }),
      expect.objectContaining({
        kind: "failed",
        code: "HTTP_STATUS_NOT_SUPPORTED",
      }),
    ]);
    expect(recorded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetId: "instrument:102110",
          resultKind: "SUCCESS",
        }),
        expect.objectContaining({
          targetId: "instrument:069500",
          resultKind: "CONTRACT_FAILURE",
          httpStatus: 403,
          stage: "search",
        }),
      ]),
    );
    expect(finalized).toEqual([
      {
        executionKey: "dividend-hourly:2026-08-01T11",
        observedAt: "2026-08-01T11:00:00+09:00",
      },
    ]);
    expect(order.at(-1)).toBe("finalize");
  });

  it("중간 discovery page에서는 Health를 종결하지 않는다", async () => {
    const finalized: string[] = [];
    const observations: DividendProviderObservationPort = {
      async record() {},
      async finalizeRun({ executionKey }) {
        finalized.push(executionKey);
      },
    };
    const application = createDividendScheduledRuntimeApplication(
      dependencies({
        pages: {
          first: { items: [target("102110")], nextCursor: "page-2" },
          "page-2": { items: [target("069500")] },
        },
        observations,
      }),
    );
    const common = {
      limit: 1,
      concurrency: 1,
      periodFrom: "2025-08-01",
      periodTo: "2026-08-01",
      executionKey: "dividend-hourly:2026-08-01T12",
      observedAt: "2026-08-01T12:00:00+09:00",
    } as const;

    const first = await application.runDiscoveryPage(common);
    expect(first.nextCursor).toBe("page-2");
    expect(finalized).toEqual([]);

    await application.runDiscoveryPage({ ...common, cursor: "page-2" });
    expect(finalized).toEqual(["dividend-hourly:2026-08-01T12"]);
  });
});

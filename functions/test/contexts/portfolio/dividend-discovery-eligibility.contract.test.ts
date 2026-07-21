import { describe, expect, it } from "vitest";
import { createDividendDiscoveryEligibilityFixture } from "../../support/dividend-discovery-eligibility-fixture";

type Market = "KRX" | "US" | "UPBIT_KRW";
type InstrumentType = "ETF" | "STOCK" | "CRYPTO";

interface HoldingInstrumentCandidate {
  assetId: string;
  market: Market;
  instrumentType?: InstrumentType;
  code: string;
  name: string;
  lifecycle: "active" | "deleted";
}

interface DisclosureRequestObservation {
  market: "KRX";
  instrumentType: "ETF";
  code: string;
}

interface DividendRefreshResult {
  phase: "DISCOVERY";
  completed: boolean;
  succeeded: readonly {
    target: { kind: "INSTRUMENT"; instrumentCode: string };
    changedEventIds: readonly string[];
  }[];
  noData: readonly { instrumentCode: string; code: string }[];
  retryableFailed: readonly { instrumentCode: string; code: string }[];
}

interface DividendAnnouncementEvent {
  eventType: "DividendEventChanged.v1";
  eventId: string;
  instrument: {
    market: "KRX";
    instrumentType: "ETF";
    code: string;
  };
  status: "announced";
}

interface DividendDiscoverySeed {
  holdings: readonly HoldingInstrumentCandidate[];
  disclosuresByCode: Readonly<
    Record<
      string,
      | { kind: "success"; sourceDisclosureId: string }
      | { kind: "no-data"; code: string }
    >
  >;
  pageSize?: number;
}

/** Holdings 공개 분류 DTO를 소비하는 배당 discovery 계약입니다. */
export interface DividendDiscoveryEligibilitySubject {
  runDiscovery(input: {
    householdId: string;
    runId: string;
    periodFrom: string;
    periodTo: string;
  }): Promise<DividendRefreshResult>;
  observedDisclosureRequests(): readonly DisclosureRequestObservation[];
  recordedEvents(): readonly DividendAnnouncementEvent[];
}

export function createSubject(
  seed: DividendDiscoverySeed,
): DividendDiscoveryEligibilitySubject {
  return createDividendDiscoveryEligibilityFixture(seed);
}

describe("배당 공시 discovery 대상 분류 계약", () => {
  it("[T-DIV-002][JOB-DIV-002] 명시적으로 분류된 active KRX ETF만 KIND discovery 대상으로 사용한다", async () => {
    const subject = createSubject({
      holdings: [
        {
          assetId: "asset-etf",
          market: "KRX",
          instrumentType: "ETF",
          code: "069500",
          name: "KODEX 200",
          lifecycle: "active",
        },
        {
          assetId: "asset-krx-stock",
          market: "KRX",
          instrumentType: "STOCK",
          code: "005930",
          name: "삼성전자",
          lifecycle: "active",
        },
        {
          assetId: "asset-us-stock",
          market: "US",
          instrumentType: "STOCK",
          code: "AAPL",
          name: "Apple",
          lifecycle: "active",
        },
        {
          assetId: "asset-crypto",
          market: "UPBIT_KRW",
          instrumentType: "CRYPTO",
          code: "KRW-BTC",
          name: "비트코인",
          lifecycle: "active",
        },
        {
          assetId: "asset-unclassified",
          market: "KRX",
          code: "123456",
          name: "분류 미확정 종목",
          lifecycle: "active",
        },
        {
          assetId: "asset-alpha-code",
          market: "KRX",
          code: "A1B2C3",
          name: "영숫자 미확정 종목",
          lifecycle: "active",
        },
        {
          assetId: "asset-deleted-etf",
          market: "KRX",
          instrumentType: "ETF",
          code: "229200",
          name: "삭제된 ETF",
          lifecycle: "deleted",
        },
      ],
      disclosuresByCode: {
        "069500": { kind: "success", sourceDisclosureId: "kind-069500-1" },
      },
    });

    const result = await subject.runDiscovery({
      householdId: "house-1",
      runId: "dividend-discovery-2026-07-20T09",
      periodFrom: "2025-07-20",
      periodTo: "2026-07-20",
    });

    expect(result).toEqual({
      phase: "DISCOVERY",
      completed: true,
      succeeded: [
        {
          target: { kind: "INSTRUMENT", instrumentCode: "069500" },
          changedEventIds: [expect.any(String)],
        },
      ],
      noData: [],
      retryableFailed: [],
    });
    expect(subject.observedDisclosureRequests()).toEqual([
      { market: "KRX", instrumentType: "ETF", code: "069500" },
    ]);
    expect(subject.recordedEvents()).toEqual([
      {
        eventType: "DividendEventChanged.v1",
        eventId: expect.any(String),
        instrument: {
          market: "KRX",
          instrumentType: "ETF",
          code: "069500",
        },
        status: "announced",
      },
    ]);
  });

  it("[T-DIV-002][JOB-DIV-002] Holdings page 경계를 넘어도 코드 형태나 이름으로 ETF를 추정하지 않는다", async () => {
    const subject = createSubject({
      pageSize: 1,
      holdings: [
        {
          assetId: "asset-unclassified",
          market: "KRX",
          code: "ETF123",
          name: "이름에 ETF가 있는 미분류 종목",
          lifecycle: "active",
        },
        {
          assetId: "asset-etf",
          market: "KRX",
          instrumentType: "ETF",
          code: "360750",
          name: "TIGER 미국S&P500",
          lifecycle: "active",
        },
      ],
      disclosuresByCode: {
        "360750": { kind: "no-data", code: "NO_DISCLOSURES" },
      },
    });

    const result = await subject.runDiscovery({
      householdId: "house-1",
      runId: "dividend-discovery-paged",
      periodFrom: "2025-07-20",
      periodTo: "2026-07-20",
    });

    expect(result).toEqual({
      phase: "DISCOVERY",
      completed: true,
      succeeded: [],
      noData: [{ instrumentCode: "360750", code: "NO_DISCLOSURES" }],
      retryableFailed: [],
    });
    expect(subject.observedDisclosureRequests()).toEqual([
      { market: "KRX", instrumentType: "ETF", code: "360750" },
    ]);
    expect(subject.recordedEvents()).toEqual([]);
  });
});

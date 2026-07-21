import { describe, expect, it } from "vitest";
import { createDividendRefreshJobFixture } from "../../support/dividend-refresh-job-fixture";

interface DisclosureFixture {
  sourceDisclosureId: string;
  instrumentCode: string;
  publishedAt: string;
  paymentDate: string;
  totalAmount: number;
}

interface DividendRefreshJobResult {
  kind: "complete" | "partial-failure";
  runId: string;
  scheduledFor: string;
  succeededInstrumentCodes: readonly string[];
  retryableFailed: readonly { instrumentCode: string; code: string }[];
  lifecycleSweepCompleted: boolean;
  projectionStatus: "queued" | "up-to-date";
}

interface DividendRefreshJobEvent {
  eventType: "DividendEventChanged.v1";
  sourceDisclosureId: string;
  instrumentCode: string;
}

export interface DividendRefreshJobSubject {
  registeredSchedule(): {
    zoneId: "Asia/Seoul";
    cron: "0 9-20 * * *";
    dailyHours: readonly number[];
  };
  runOccurrence(input: {
    scheduledFor: string;
    runId: string;
  }): Promise<DividendRefreshJobResult>;
  listDisclosures(): readonly DisclosureFixture[];
  recordedEvents(): readonly DividendRefreshJobEvent[];
  annualProjection(year: number): {
    monthlyAmounts: readonly number[];
    eventIds: readonly string[];
  };
}

export function createSubject(seed: {
  disclosures: readonly DisclosureFixture[];
  providerFailureCodes?: Readonly<Record<string, string>>;
}): DividendRefreshJobSubject {
  return createDividendRefreshJobFixture(seed);
}

const disclosureA: DisclosureFixture = {
  sourceDisclosureId: "kind-a",
  instrumentCode: "069500",
  publishedAt: "2026-07-20T10:30:00+09:00",
  paymentDate: "2026-08-20",
  totalAmount: 1_000,
};

describe("배당 매시 discovery·lifecycle refresh job 계약", () => {
  it("[T-JOB-DIV-001][JOB-DIV-001/DEC-062] 서울 09시부터 20시까지 매시 정각인 12개 occurrence만 등록한다", () => {
    expect(createSubject({ disclosures: [] }).registeredSchedule()).toEqual({
      zoneId: "Asia/Seoul",
      cron: "0 9-20 * * *",
      dailyHours: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    });
  });

  it("[T-JOB-DIV-001][JOB-DIV-001] 한 instrument timeout은 다른 성공 Event를 rollback하지 않고 정확한 retry 범위를 반환한다", async () => {
    const disclosureB: DisclosureFixture = {
      ...disclosureA,
      sourceDisclosureId: "kind-b",
      instrumentCode: "360750",
    };
    const subject = createSubject({
      disclosures: [disclosureA, disclosureB],
      providerFailureCodes: { "360750": "DISCLOSURE_TIMEOUT" },
    });

    const result = await subject.runOccurrence({
      scheduledFor: "2026-07-20T11:00:00+09:00",
      runId: "dividend:2026-07-20T11",
    });

    expect(result).toEqual({
      kind: "partial-failure",
      runId: "dividend:2026-07-20T11",
      scheduledFor: "2026-07-20T11:00:00+09:00",
      succeededInstrumentCodes: ["069500"],
      retryableFailed: [
        { instrumentCode: "360750", code: "DISCLOSURE_TIMEOUT" },
      ],
      lifecycleSweepCompleted: true,
      projectionStatus: "queued",
    });
    expect(subject.recordedEvents()).toEqual([
      {
        eventType: "DividendEventChanged.v1",
        sourceDisclosureId: "kind-a",
        instrumentCode: "069500",
      },
    ]);
  });

  it("[T-JOB-DIV-001][JOB-DIV-001/DEC-062] 17시30분 공시는 17시가 아니라 18시 occurrence에서 수집한다", async () => {
    const lateDisclosure: DisclosureFixture = {
      ...disclosureA,
      sourceDisclosureId: "kind-late",
      publishedAt: "2026-07-20T17:30:00+09:00",
    };
    const subject = createSubject({ disclosures: [lateDisclosure] });

    const before = await subject.runOccurrence({
      scheduledFor: "2026-07-20T17:00:00+09:00",
      runId: "dividend:2026-07-20T17",
    });
    expect(before.succeededInstrumentCodes).toEqual([]);
    expect(subject.listDisclosures()).toEqual([]);

    const after = await subject.runOccurrence({
      scheduledFor: "2026-07-20T18:00:00+09:00",
      runId: "dividend:2026-07-20T18",
    });
    expect(after.succeededInstrumentCodes).toEqual(["069500"]);
    expect(subject.listDisclosures()).toEqual([lateDisclosure]);
  });

  it("[T-JOB-DIV-001][JOB-DIV-001] 같은 시간 occurrence 재실행은 Event와 Projection을 중복 반영하지 않는다", async () => {
    const subject = createSubject({ disclosures: [disclosureA] });
    const input = {
      scheduledFor: "2026-07-20T11:00:00+09:00",
      runId: "dividend:2026-07-20T11",
    };

    const first = await subject.runOccurrence(input);
    const projection = subject.annualProjection(2026);
    const replay = await subject.runOccurrence(input);

    expect(replay).toEqual(first);
    expect(subject.recordedEvents()).toHaveLength(1);
    expect(subject.annualProjection(2026)).toEqual(projection);
  });
});

import { describe, expect, it } from "vitest";

import {
  executionKeyFor,
  expectedBusinessOccurrences,
  occurrenceFor,
} from "../../../src/operations/scheduling/scheduledOccurrence";
import { loadScheduledJobDefinitions } from "../../../src/operations/scheduling/scheduledJobDefinitions";

describe("scheduled occurrence", () => {
  it("서울 날짜와 시각을 execution key에 안정적으로 반영한다", () => {
    expect(
      executionKeyFor("asset-valuation-daily", "2026-07-21T14:55:00.000Z"),
    ).toBe("asset-valuation-daily:2026-07-21");
    expect(
      executionKeyFor("dividend-hourly", "2026-07-21T09:00:00.000Z"),
    ).toBe("dividend-hourly:2026-07-21T18");
    expect(
      executionKeyFor("billing-cost-refresh", "2026-07-21T09:00:00.000Z"),
    ).toBe("billing-cost-refresh:2026-07-21T18");
    expect(
      occurrenceFor("instrument-catalog-daily", "2026-07-20T21:00:00+00:00"),
    ).toEqual({
      jobName: "instrument-catalog-daily",
      scheduledFor: "2026-07-20T21:00:00.000Z",
      executionKey: "instrument-catalog:2026-07-21:1",
    });
  });

  it("업무 함수가 호출되지 않아도 최근 48시간의 예정 실행을 생성한다", () => {
    const occurrences = expectedBusinessOccurrences({
      observedAt: "2026-07-21T15:01:00.000Z",
      lookbackHours: 48,
      definitions: loadScheduledJobDefinitions(),
    });

    expect(occurrences).toContainEqual(
      expect.objectContaining({
        jobName: "recurring-daily",
        executionKey: "recurring-daily:2026-07-21",
      }),
    );
    expect(
      occurrences.filter(
        ({ jobName, executionKey }) =>
          jobName === "dividend-hourly" && executionKey.startsWith("dividend-hourly:2026-07-21"),
      ),
    ).toEqual([{
      jobName: "dividend-hourly",
      scheduledFor: "2026-07-21T10:00:00.000Z",
      executionKey: "dividend-hourly:2026-07-21T19",
    }]);
    expect(
      occurrences.filter(({ jobName }) => jobName === "billing-cost-refresh"),
    ).toHaveLength(0);
    expect(
      occurrences.some(({ jobName }) => jobName === "scheduled-job-monitor"),
    ).toBe(false);
  });

  it("신규 업무는 모니터링 시작 시각 이전 실행을 누락으로 만들지 않는다", () => {
    const occurrences = expectedBusinessOccurrences({
      observedAt: "2026-08-03T21:01:00.000Z",
      lookbackHours: 48,
      definitions: loadScheduledJobDefinitions(),
    }).filter(({ jobName }) => jobName === "billing-cost-refresh");

    expect(occurrences).toHaveLength(5);
    expect(occurrences.map(({ executionKey }) => executionKey)).not.toContain(
      "billing-cost-refresh:2026-08-03T00",
    );
    expect(occurrences.map(({ executionKey }) => executionKey)).toContain(
      "billing-cost-refresh:2026-08-03T06",
    );
  });

  it.each([
    ["2026-09-20T00:00:00.000Z", []],
    ["2026-09-20T09:59:59.999Z", []],
    ["2026-09-20T10:00:00.000Z", ["dividend-hourly:2026-09-20T19"]],
    ["2026-09-20T11:00:00.000Z", ["dividend-hourly:2026-09-20T19"]],
  ] as const)("배당은 주말에도 서울 19시 한 번만 감시하며 다른 시간의 누락을 만들지 않는다: %s", (observedAt, expectedKeys) => {
    const occurrences = expectedBusinessOccurrences({
      observedAt,
      lookbackHours: 2,
      definitions: loadScheduledJobDefinitions(),
    }).filter(({ jobName }) => jobName === "dividend-hourly");
    expect(occurrences.map(({ executionKey }) => executionKey)).toEqual(expectedKeys);
  });

  it("관찰 시각보다 미래인 당일 실행은 기대값에 포함하지 않는다", () => {
    const occurrences = expectedBusinessOccurrences({
      observedAt: "2026-07-21T00:30:00.000Z",
      lookbackHours: 48,
      definitions: loadScheduledJobDefinitions(),
    });
    expect(
      occurrences.some(
        ({ executionKey }) => executionKey === "instrument-catalog:2026-07-21:1",
      ),
    ).toBe(true);
    expect(
      occurrences.some(
        ({ executionKey }) =>
          executionKey === "asset-valuation-daily:2026-07-21",
      ),
    ).toBe(false);
  });
});

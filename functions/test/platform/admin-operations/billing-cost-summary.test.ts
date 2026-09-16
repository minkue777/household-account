import { describe, expect, it } from "vitest";

import {
  refreshBillingCost,
  summarizeBillingCost,
} from "../../../src/platform/admin-operations/application/billingCostSummary";

describe("Google Cloud 비용 요약", () => {
  it("[T-EXT-005][EXT-004] 이번 달 누적 순비용과 최근 완료 7일 평균으로 월말 비용을 추정한다", () => {
    const result = summarizeBillingCost({
      calculatedAt: "2026-08-02T06:00:00.000Z",
      source: {
        currency: "KRW",
        dataUpdatedAt: "2026-08-02T05:40:00.000Z",
        dailyAmounts: [
          { date: "2026-07-26", amount: 10 },
          { date: "2026-07-27", amount: 10 },
          { date: "2026-07-28", amount: 10 },
          { date: "2026-07-29", amount: 10 },
          { date: "2026-07-30", amount: 10 },
          { date: "2026-07-31", amount: 10 },
          { date: "2026-08-01", amount: 10 },
          { date: "2026-08-02", amount: 859 },
        ],
        serviceAmounts: [
          { serviceId: "firestore", serviceName: "Firestore", amount: 250.4 },
          { serviceId: "functions", serviceName: "Cloud Functions", amount: 618.6 },
        ],
      },
    });

    expect(result).toEqual({
      billingMonth: "2026-08",
      currency: "KRW",
      monthToDateAmount: 869,
      estimatedMonthEndAmount: 1_159,
      calculatedAt: "2026-08-02T06:00:00.000Z",
      dataUpdatedAt: "2026-08-02T05:40:00.000Z",
      serviceAmounts: [
        { serviceId: "functions", serviceName: "Cloud Functions", amount: 619 },
        { serviceId: "firestore", serviceName: "Firestore", amount: 250 },
      ],
    });
  });

  it("비용이 없으면 누적값과 예상값을 모두 0으로 유지한다", () => {
    const result = summarizeBillingCost({
      calculatedAt: "2026-08-31T14:00:00.000Z",
      source: {
        currency: "KRW",
        dataUpdatedAt: "2026-08-31T13:50:00.000Z",
        dailyAmounts: [],
        serviceAmounts: [],
      },
    });

    expect(result.monthToDateAmount).toBe(0);
    expect(result.estimatedMonthEndAmount).toBe(0);
  });

  it("[T-EXT-005][EXT-004] 원천 조회 뒤 요약을 한 번 저장한다", async () => {
    const saved: unknown[] = [];
    const result = await refreshBillingCost({
      projectId: "household-account-6f300",
      calculatedAt: "2026-08-02T06:00:00.000Z",
      source: {
        async read(input) {
          expect(input.projectId).toBe("household-account-6f300");
          return {
            currency: "KRW",
            dataUpdatedAt: "2026-08-02T05:40:00.000Z",
            dailyAmounts: [{ date: "2026-08-02", amount: 869 }],
            serviceAmounts: [],
          };
        },
      },
      store: {
        async save(summary) {
          saved.push(summary);
        },
      },
    });

    expect(saved).toEqual([result]);
  });
});

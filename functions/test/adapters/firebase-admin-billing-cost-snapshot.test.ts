import { describe, expect, it } from "vitest";

import { parseAdminDashboardBillingCost } from "../../src/adapters/firebase/admin/firebaseAdminDashboardReader";

describe("admin billing cost Firestore snapshot", () => {
  it("versioned snapshot을 dashboard wire value로 읽는다", () => {
    expect(parseAdminDashboardBillingCost({
      schemaVersion: 1,
      status: "available",
      billingMonth: "2026-08",
      currency: "KRW",
      monthToDateAmount: 869,
      estimatedMonthEndAmount: 1_400,
      calculatedAt: "2026-08-02T06:00:00.000Z",
      dataUpdatedAt: "2026-08-02T05:40:00.000Z",
      serviceAmounts: [{
        serviceId: "functions",
        serviceName: "Cloud Functions",
        amount: 500,
      }],
    }, "2026-08-02T06:00:00.000Z")).toEqual({
      status: "available",
      billingMonth: "2026-08",
      currency: "KRW",
      monthToDateAmount: 869,
      estimatedMonthEndAmount: 1_400,
      calculatedAt: "2026-08-02T06:00:00.000Z",
      dataUpdatedAt: "2026-08-02T05:40:00.000Z",
      serviceAmounts: [{
        serviceId: "functions",
        serviceName: "Cloud Functions",
        amount: 500,
      }],
    });
  });

  it("불완전하거나 구버전인 snapshot은 admin 전체를 실패시키지 않는다", () => {
    expect(parseAdminDashboardBillingCost(
      undefined,
      "2026-08-02T06:00:00.000Z",
    )).toEqual({
      status: "unavailable",
    });
    expect(parseAdminDashboardBillingCost({
      schemaVersion: 0,
      status: "available",
    }, "2026-08-02T06:00:00.000Z")).toEqual({ status: "unavailable" });
  });

  it("이전 달의 마지막 성공 snapshot을 이번 달 비용으로 표시하지 않는다", () => {
    expect(parseAdminDashboardBillingCost({
      schemaVersion: 1,
      status: "available",
      billingMonth: "2026-07",
      currency: "KRW",
      monthToDateAmount: 869,
      estimatedMonthEndAmount: 1_400,
      calculatedAt: "2026-07-31T12:00:00.000Z",
      dataUpdatedAt: "2026-07-31T11:40:00.000Z",
      serviceAmounts: [],
    }, "2026-08-01T00:10:00.000Z")).toEqual({
      status: "unavailable",
    });
  });
});

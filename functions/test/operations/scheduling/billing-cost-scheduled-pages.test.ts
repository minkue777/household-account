import { describe, expect, it, vi } from "vitest";

import { createBillingCostScheduledPages } from "../../../src/operations/scheduling/billingCostScheduledPages";
import { BillingCostSourceNotReadyError } from "../../../src/platform/admin-operations/application/billingCostSummary";

describe("billing cost scheduled page", () => {
  it("export 설정 전에는 장애를 만들지 않고 정상 생략한다", async () => {
    const page = createBillingCostScheduledPages({
      calculatedAt: "2026-08-02T06:00:00.000Z",
      store: { save: vi.fn() },
    });

    await expect(page.nextPage()).resolves.toEqual({
      checkpointAfter: "billing-cost:complete",
      terminal: true,
      targets: [{
        targetId: "billing-cost:current",
        outcome: {
          kind: "SKIPPED",
          receipt: "billing-export-not-configured",
        },
      }],
    });
  });

  it("BigQuery 비용을 요약해 저장하고 완료 receipt를 남긴다", async () => {
    const save = vi.fn();
    const page = createBillingCostScheduledPages({
      projectId: "household-account-6f300",
      calculatedAt: "2026-08-02T06:00:00.000Z",
      source: {
        read: vi.fn(async () => ({
          currency: "KRW",
          dataUpdatedAt: "2026-08-02T05:40:00.000Z",
          dailyAmounts: [{ date: "2026-08-02", amount: 869 }],
          serviceAmounts: [],
        })),
      },
      store: { save },
    });

    const result = await page.nextPage();

    expect(save).toHaveBeenCalledOnce();
    expect(result?.targets).toEqual([{
      targetId: "billing-cost:current",
      outcome: {
        kind: "SUCCEEDED",
        receipt: "2026-08:2026-08-02T05:40:00.000Z",
      },
    }]);
    await expect(page.nextPage("billing-cost:complete")).resolves.toBeUndefined();
  });

  it("조회 실패를 일반 사용자 화면과 분리된 target 실패로 기록한다", async () => {
    const onFailure = vi.fn();
    const page = createBillingCostScheduledPages({
      projectId: "household-account-6f300",
      calculatedAt: "2026-08-02T06:00:00.000Z",
      source: { read: vi.fn(async () => { throw new Error("HTTP_500"); }) },
      store: { save: vi.fn() },
      onFailure,
    });

    const result = await page.nextPage();

    expect(onFailure).toHaveBeenCalledOnce();
    expect(result?.targets[0].outcome).toEqual({
      kind: "FAILED",
      code: "BILLING_COST_REFRESH_FAILED",
      retryable: false,
    });
  });

  it("export table 생성 대기 중에는 장애를 열지 않고 정상 생략한다", async () => {
    const onFailure = vi.fn();
    const page = createBillingCostScheduledPages({
      projectId: "household-account-6f300",
      calculatedAt: "2026-08-02T06:00:00.000Z",
      source: {
        read: vi.fn(async () => {
          throw new BillingCostSourceNotReadyError();
        }),
      },
      store: { save: vi.fn() },
      onFailure,
    });

    await expect(page.nextPage()).resolves.toMatchObject({
      targets: [{
        outcome: {
          kind: "SKIPPED",
          receipt: "billing-export-data-not-ready",
        },
      }],
    });
    expect(onFailure).not.toHaveBeenCalled();
  });
});

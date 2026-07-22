import { describe, expect, it } from "vitest";

// @ts-ignore 운영용 ESM 스크립트는 별도 declaration을 배포하지 않습니다.
import { comparison, normalizers } from "../../scripts/reconcile-runtime.mjs";

describe("runtime reconciliation 보존 업무 사실 비교", () => {
  it("명시적으로 변환되는 creator·owner·기본 설정·최초 적용 월은 원문 동일성 대상이 아니다", () => {
    expect(
      comparison(
        "ledger",
        [normalizers.ledger("ledger-1", {
          merchant: "가맹점",
          amount: 10_000,
          date: "2026-07-20",
          category: "etc",
          createdBy: "",
          source: "manual",
        })],
        [normalizers.ledger("ledger-1", {
          merchant: "가맹점",
          amountInWon: 10_000,
          accountingDate: "2026-07-20",
          categoryId: "etc",
          creatorMemberId: "member-confirmed",
          source: "manual",
        })],
      ).status,
    ).toBe("MATCH");
    expect(
      comparison(
        "asset",
        [normalizers.asset("asset-1", {
          name: "적금",
          type: "savings",
          owner: "민규",
          currentBalance: 1_000_000,
        })],
        [normalizers.asset("asset-1", {
          name: "적금",
          type: "savings",
          ownerRef: { kind: "profile", profileId: "profile-minkyu" },
          currentBalance: 1_000_000,
        })],
      ).status,
    ).toBe("MATCH");
    expect(
      comparison(
        "category",
        [normalizers.category("category-1", {
          name: "",
          label: "기타",
          color: "#123456",
          order: 3,
          isDefault: true,
        })],
        [normalizers.category("category-1", {
          name: "기타",
          color: "#123456",
          sortOrder: 3,
          state: "active",
        })],
      ).status,
    ).toBe("MATCH");
    expect(
      comparison(
        "recurring",
        [normalizers.recurring("plan-1", {
          merchant: "보험",
          amount: 30_000,
          category: "fixed",
          dayOfMonth: 10,
        })],
        [normalizers.recurring("plan-1", {
          merchant: "보험",
          amountInWon: 30_000,
          categoryId: "fixed",
          dayOfMonth: 10,
          creatorMemberId: "member-confirmed",
          firstApplicableMonth: "2026-07",
        })],
      ).status,
    ).toBe("MATCH");
  });

  it("보존해야 하는 금액이 달라지면 MISMATCH를 반환한다", () => {
    expect(
      comparison(
        "ledger",
        [normalizers.ledger("ledger-1", { amount: 10_000 })],
        [normalizers.ledger("ledger-1", { amountInWon: 9_000 })],
      ).status,
    ).toBe("MISMATCH");
  });

  it("manifest로 보완한 market과 수동 보유 synthetic code는 원문 동일성 대상에서 제외한다", () => {
    expect(
      comparison(
        "position",
        [normalizers.position("cash-1", {
          assetId: "asset-1",
          stockCode: "",
          stockName: "예수금",
          holdingType: "cash",
          quantity: 1,
          currentPrice: 100_000,
        })],
        [normalizers.position("cash-1", {
          assetId: "asset-1",
          positionKind: "stock",
          instrumentCode: "LEGACY:CASH:cash-1",
          instrumentName: "예수금",
          holdingType: "cash",
          market: "UNRESOLVED",
          quantity: 1,
          lastQuote: { priceInWon: 100_000 },
        })],
      ).status,
    ).toBe("MATCH");
  });
});

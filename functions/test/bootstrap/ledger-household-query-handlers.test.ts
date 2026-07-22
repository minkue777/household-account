import { describe, expect, it, vi } from "vitest";

import { createLedgerHouseholdQueryHandlers } from "../../src/bootstrap/queries/ledgerHouseholdQueryHandlers";
import { createHouseholdQueryRouter } from "../../src/bootstrap/queries/householdQueryRouter";

function subject() {
  const list = vi.fn(async () => [
    {
      id: "transaction-1",
      aggregateVersion: 2,
      date: "2026-07-22",
      merchant: "가맹점",
      amount: 12_000,
      transactionType: "expense" as const,
      category: "etc",
      cardDisplay: "삼성(1876)",
    },
  ]);
  const router = createHouseholdQueryRouter({
    handlers: createLedgerHouseholdQueryHandlers({ list }),
    memberships: {
      async resolveActor({ principalUid, householdId }) {
        return {
          kind: "active" as const,
          actor: {
            principalUid,
            householdId,
            actingMemberId: "member-1",
            capabilities: [],
          },
        };
      },
    },
  });
  const execute = (payload: Record<string, unknown>) => router.execute({
    principalUid: "uid-1",
    request: {
      contractVersion: "household-query.v1",
      queryId: "query-1",
      householdId: "household-1",
      query: "ledger.list-transactions.v1",
      payload,
    },
  });
  return { execute, list };
}

describe("Ledger household range query contract", () => {
  it("인증된 가구 범위와 요청 기간만 read port에 전달한다", async () => {
    const fixture = subject();

    await expect(fixture.execute({
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      transactionType: "expense",
    })).resolves.toEqual({
      kind: "success",
      queryId: "query-1",
      data: {
        transactions: [expect.objectContaining({ id: "transaction-1" })],
      },
    });
    expect(fixture.list).toHaveBeenCalledWith({
      householdId: "household-1",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      transactionType: "expense",
    });
  });

  it("유효하지 않은 날짜나 추가 필드는 조회 전에 거부한다", async () => {
    const fixture = subject();

    await expect(fixture.execute({
      startDate: "2026-02-30",
      endDate: "2026-07-31",
      transactionType: "expense",
    })).resolves.toMatchObject({ kind: "error" });
    expect(fixture.list).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";

import { createBasicLedgerCommandsFixtureSubject } from "../../../support/basic-ledger-commands-fixture";

export interface LedgerSeoulTimeContractSubject {
  recordManualExpense(input: {
    commandId: string;
    actor: { householdId: string; actingMemberId: string };
    merchant: string;
    amountInWon: number;
    categoryId: string;
    accountingDate: string;
  }): Promise<unknown>;
}

export function createSubject(input: {
  now: string;
  activeCategoryIds: readonly string[];
}): LedgerSeoulTimeContractSubject {
  return createBasicLedgerCommandsFixtureSubject(input);
}

describe("ledger business timezone", () => {
  it("UTC instant를 거래의 Asia/Seoul HH:mm으로 변환한다", async () => {
    const subject = createSubject({
      now: "2026-07-21T00:17:00.000Z",
      activeCategoryIds: ["food"],
    });

    const result = await subject.recordManualExpense({
      commandId: "utc-to-seoul",
      actor: { householdId: "house-1", actingMemberId: "member-a" },
      merchant: "식당",
      amountInWon: 10_000,
      categoryId: "food",
      accountingDate: "2026-07-21",
    });

    expect(result).toMatchObject({
      kind: "success",
      value: { localTime: "09:17" },
    });
  });
});

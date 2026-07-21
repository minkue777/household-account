import { describe, expect, it } from "vitest";

import { createMonthlySplitLifecycleFixtureSubject } from "../../../support/monthly-split-lifecycle-fixture";

interface SplitTransaction {
  transactionId: string;
  householdId: string;
  transactionType: "expense" | "income";
  lifecycleState: "active" | "superseded";
  amountInWon: number;
  accountingDate: string;
  merchant: string;
  categoryId: string;
  memo: string;
  cardType: string;
  cardDisplay: string;
  creatorMemberId: string;
  source: string;
  originChannel: string;
  aggregateVersion: number;
  splitGroup?: {
    groupId: string;
    index: number;
    total: number;
    originalId: string;
  };
}

export interface ExistingMonthlySplitContractSubject {
  splitExisting(input: {
    operationKey: string;
    actor: { householdId: string; actingMemberId: string };
    transactionId: string;
    expectedVersion: number;
    months: number;
  }): Promise<unknown>;
  state(): readonly SplitTransaction[];
}

export function createSubject(input: {
  transactions: readonly SplitTransaction[];
}): ExistingMonthlySplitContractSubject {
  return createMonthlySplitLifecycleFixtureSubject(input);
}

function activeOriginal(): SplitTransaction {
  return {
    transactionId: "transaction-1",
    householdId: "house-1",
    transactionType: "expense",
    lifecycleState: "active",
    amountInWon: 10_000,
    accountingDate: "2026-01-31",
    merchant: "보험료",
    categoryId: "fixed",
    memo: "원본 메모",
    cardType: "captured",
    cardDisplay: "국민카드(1234)",
    creatorMemberId: "member-a",
    source: "notification",
    originChannel: "android",
    aggregateVersion: 4,
  };
}

describe("기존 거래 월 분할 계약", () => {
  it("원본은 superseded로 보존하고 파생 거래를 원자적으로 생성한다", async () => {
    const subject = createSubject({
      transactions: [activeOriginal()],
    });

    const result = await subject.splitExisting({
      operationKey: "split-existing-3",
      actor: { householdId: "house-1", actingMemberId: "member-a" },
      transactionId: "transaction-1",
      expectedVersion: 4,
      months: 3,
    });

    expect(result).toMatchObject({ kind: "success" });
    expect(subject.state()).toHaveLength(4);
    expect(subject.state()[0]).toMatchObject({
      transactionId: "transaction-1",
      lifecycleState: "superseded",
      aggregateVersion: 5,
    });
    expect(subject.state().slice(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lifecycleState: "active",
          cardDisplay: "국민카드(1234)",
          source: "notification",
          splitGroup: expect.objectContaining({
            groupId: "monthly-group:split-existing-3",
            originalId: "transaction-1",
            total: 3,
          }),
        }),
      ]),
    );
  });

  it("expectedVersion이 오래되었으면 원본과 파생을 모두 변경하지 않는다", async () => {
    const initial = activeOriginal();
    const subject = createSubject({
      transactions: [initial],
    });

    const result = await subject.splitExisting({
      operationKey: "split-existing-stale",
      actor: { householdId: "house-1", actingMemberId: "member-a" },
      transactionId: "transaction-1",
      expectedVersion: 3,
      months: 3,
    });

    expect(result).toEqual({ kind: "conflict", code: "VERSION_MISMATCH" });
    expect(subject.state()).toEqual([initial]);
  });
});

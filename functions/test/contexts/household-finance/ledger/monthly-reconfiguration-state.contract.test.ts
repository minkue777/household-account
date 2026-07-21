import { describe, expect, it } from "vitest";
import { createMonthlyReconfigurationFixtureSubject } from "../../../support/monthly-reconfiguration-fixture";

export interface MonthlyReconfigurationTransaction {
  transactionId: string;
  householdId: string;
  lifecycleState: "active" | "superseded";
  merchant: string;
  amountInWon: number;
  categoryId: string;
  memo: string;
  accountingDate: string;
  localTime: string;
  cardDisplay: string;
  cardEvidence: string;
  source: string;
  originChannel: string;
  creatorMemberId: string;
  captureLineageId: string;
  localCurrencyType?: string;
  aggregateVersion: number;
  monthlyGroup?: {
    groupId: string;
    originalTransactionId: string;
    index: number;
    total: number;
    groupVersion: number;
  };
}

export type MonthlyReconfigurationResult =
  | { kind: "Reconfigured"; activeTransactionIds: readonly string[] }
  | { kind: "ValidationError"; code: string }
  | { kind: "Conflict"; code: string }
  | { kind: "RetryableFailure"; code: string };

export interface MonthlyReconfigurationContractSubject {
  reconfigure(input: {
    actor: { householdId: string; memberId: string };
    operationKey: string;
    groupId: string;
    months: number;
    expectedVersions: Readonly<Record<string, number>>;
  }): Promise<MonthlyReconfigurationResult>;
  snapshot(): readonly MonthlyReconfigurationTransaction[];
}

export function createSubject(fixture: {
  transactions: readonly MonthlyReconfigurationTransaction[];
}): MonthlyReconfigurationContractSubject {
  return createMonthlyReconfigurationFixtureSubject(fixture);
}

const immutableEvidence = {
  categoryId: "category-life",
  memo: "할부 메모",
  localTime: "15:20",
  cardDisplay: "국민카드(1234)",
  cardEvidence: "KB:1234",
  source: "android-notification",
  originChannel: "android",
  creatorMemberId: "member-1",
  captureLineageId: "lineage-1",
  localCurrencyType: "gyeonggi",
};

const original: MonthlyReconfigurationTransaction = {
  transactionId: "original",
  householdId: "household-1",
  lifecycleState: "superseded",
  merchant: "국민카드 결제",
  amountInWon: 10_000,
  accountingDate: "2026-07-31",
  aggregateVersion: 2,
  ...immutableEvidence,
};

function oldPart(index: number): MonthlyReconfigurationTransaction {
  return {
    transactionId: `old-part-${index}`,
    householdId: "household-1",
    lifecycleState: "active",
    merchant: `국민카드 결제 (${index}/3)`,
    amountInWon: 3_333,
    accountingDate: ["2026-07-31", "2026-08-31", "2026-09-30"][index - 1],
    aggregateVersion: 1,
    ...immutableEvidence,
    monthlyGroup: {
      groupId: "group-old",
      originalTransactionId: "original",
      index,
      total: 3,
      groupVersion: 1,
    },
  };
}

describe("월 분할 재구성의 전체 필드·상태 공개 계약", () => {
  it("[T-SPL-005][SPL-004/LED-009/LED-010] 재구성은 원본·기존 항목을 superseded로 보존하고 새 active 그룹에 전체 증거를 유지한다", async () => {
    const subject = createSubject({
      transactions: [original, oldPart(1), oldPart(2), oldPart(3)],
    });

    const result = await subject.reconfigure({
      actor: { householdId: "household-1", memberId: "member-1" },
      operationKey: "reconfigure-four-months",
      groupId: "group-old",
      months: 4,
      expectedVersions: {
        original: 2,
        "old-part-1": 1,
        "old-part-2": 1,
        "old-part-3": 1,
      },
    });

    expect(result).toMatchObject({
      kind: "Reconfigured",
      activeTransactionIds: expect.arrayContaining([
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
      ]),
    });
    const state = subject.snapshot();
    expect(
      state.find(({ transactionId }) => transactionId === "original"),
    ).toMatchObject({ lifecycleState: "superseded", amountInWon: 10_000 });
    expect(
      state
        .filter(({ transactionId }) => transactionId.startsWith("old-part-"))
        .every(({ lifecycleState }) => lifecycleState === "superseded"),
    ).toBe(true);

    const active = state
      .filter(
        ({ lifecycleState, monthlyGroup }) =>
          lifecycleState === "active" && monthlyGroup?.groupId !== "group-old",
      )
      .sort(
        (left, right) =>
          (left.monthlyGroup?.index ?? 0) - (right.monthlyGroup?.index ?? 0),
      );
    expect(active).toHaveLength(4);
    expect(
      active.map(
        ({
          merchant,
          amountInWon,
          accountingDate,
          categoryId,
          memo,
          localTime,
          cardDisplay,
          cardEvidence,
          source,
          originChannel,
          creatorMemberId,
          captureLineageId,
          localCurrencyType,
          monthlyGroup,
        }) => ({
          merchant,
          amountInWon,
          accountingDate,
          categoryId,
          memo,
          localTime,
          cardDisplay,
          cardEvidence,
          source,
          originChannel,
          creatorMemberId,
          captureLineageId,
          localCurrencyType,
          index: monthlyGroup?.index,
          total: monthlyGroup?.total,
          originalTransactionId: monthlyGroup?.originalTransactionId,
        }),
      ),
    ).toEqual([
      {
        merchant: "국민카드 결제 (1/4)",
        amountInWon: 2_500,
        accountingDate: "2026-07-31",
        ...immutableEvidence,
        index: 1,
        total: 4,
        originalTransactionId: "original",
      },
      {
        merchant: "국민카드 결제 (2/4)",
        amountInWon: 2_500,
        accountingDate: "2026-08-31",
        ...immutableEvidence,
        index: 2,
        total: 4,
        originalTransactionId: "original",
      },
      {
        merchant: "국민카드 결제 (3/4)",
        amountInWon: 2_500,
        accountingDate: "2026-09-30",
        ...immutableEvidence,
        index: 3,
        total: 4,
        originalTransactionId: "original",
      },
      {
        merchant: "국민카드 결제 (4/4)",
        amountInWon: 2_500,
        accountingDate: "2026-10-31",
        ...immutableEvidence,
        index: 4,
        total: 4,
        originalTransactionId: "original",
      },
    ]);
  });
});

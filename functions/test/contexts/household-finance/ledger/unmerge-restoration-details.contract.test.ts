import { describe, expect, it } from "vitest";
import { createUnmergeRestorationFixtureSubject } from "../../../support/unmerge-restoration-fixture";

export interface UnmergeLeafSnapshot {
  transactionId?: string;
  merchant: string;
  amountInWon: number;
  categoryId: string;
  memo: string;
  source: string;
  originChannel: string;
  creatorMemberId: string;
  captureLineageId?: string;
  captureCardEvidence: string;
}

export interface UnmergeTransaction {
  transactionId: string;
  householdId: string;
  lifecycleState: "active" | "superseded";
  merchant: string;
  amountInWon: number;
  categoryId: string;
  memo: string;
  accountingDate: string;
  localTime: string;
  transactionType: "expense" | "income";
  cardDisplay: string;
  source: string;
  originChannel: string;
  creatorMemberId: string;
  captureLineageId?: string;
  captureCardEvidence: string;
  aggregateVersion: number;
  mergeLeafSnapshots?: readonly UnmergeLeafSnapshot[];
}

export type UnmergeRestorationResult =
  | { kind: "Unmerged"; restoredTransactionIds: readonly string[] }
  | { kind: "ContractFailure"; code: "RESTORATION_SNAPSHOT_INCOMPLETE" }
  | { kind: "Conflict"; code: string }
  | { kind: "RetryableFailure"; code: string };

export interface UnmergeRestorationContractSubject {
  unmerge(input: {
    actor: { householdId: string; memberId: string };
    operationKey: string;
    mergedTransactionId: string;
    expectedVersion: number;
  }): Promise<UnmergeRestorationResult>;
  snapshot(): readonly UnmergeTransaction[];
}

export function createSubject(fixture: {
  transactions: readonly UnmergeTransaction[];
}): UnmergeRestorationContractSubject {
  return createUnmergeRestorationFixtureSubject(fixture);
}

const leafA: UnmergeLeafSnapshot = {
  transactionId: "A",
  merchant: "원본 A",
  amountInWon: 1_000,
  categoryId: "category-a",
  memo: "메모 A",
  source: "android-notification",
  originChannel: "android",
  creatorMemberId: "member-a",
  captureLineageId: "lineage-a",
  captureCardEvidence: "KB:1111",
};

const leafB: UnmergeLeafSnapshot = {
  transactionId: "B",
  merchant: "원본 B",
  amountInWon: 2_000,
  categoryId: "category-b",
  memo: "메모 B",
  source: "ios-shortcut",
  originChannel: "shortcut",
  creatorMemberId: "member-b",
  captureLineageId: "lineage-b",
  captureCardEvidence: "SAMSUNG:2222",
};

function storedLeaf(snapshot: UnmergeLeafSnapshot): UnmergeTransaction {
  return {
    transactionId: snapshot.transactionId ?? "missing",
    householdId: "household-1",
    lifecycleState: "superseded",
    merchant: snapshot.merchant,
    amountInWon: snapshot.amountInWon,
    categoryId: snapshot.categoryId,
    memo: snapshot.memo,
    accountingDate: "2026-06-01",
    localTime: "09:00",
    transactionType: "expense",
    cardDisplay: "과거 표시 카드",
    source: snapshot.source,
    originChannel: snapshot.originChannel,
    creatorMemberId: snapshot.creatorMemberId,
    captureLineageId: snapshot.captureLineageId,
    captureCardEvidence: snapshot.captureCardEvidence,
    aggregateVersion: 2,
  };
}

function merged(
  snapshots: readonly UnmergeLeafSnapshot[] | undefined,
): UnmergeTransaction {
  return {
    transactionId: "merged",
    householdId: "household-1",
    lifecycleState: "active",
    merchant: "합친 거래",
    amountInWon: 3_000,
    categoryId: "merged-category",
    memo: "합친 메모",
    accountingDate: "2026-07-20",
    localTime: "18:45",
    transactionType: "expense",
    cardDisplay: "현대카드(9999)",
    source: "manual-merge",
    originChannel: "web",
    creatorMemberId: "member-editor",
    captureCardEvidence: "MERGED-DISPLAY-ONLY",
    aggregateVersion: 4,
    mergeLeafSnapshots: snapshots,
  };
}

describe("Ledger unmerge 전체 필드 복원 공개 계약", () => {
  it("[T-MRG-002][MRG-002/LED-009] 원본별 표시·capture 필드와 합친 거래의 공통 날짜·시각·유형·표시 카드를 함께 복원한다", async () => {
    const subject = createSubject({
      transactions: [storedLeaf(leafA), storedLeaf(leafB), merged([leafA, leafB])],
    });

    expect(
      await subject.unmerge({
        actor: { householdId: "household-1", memberId: "member-editor" },
        operationKey: "unmerge-complete",
        mergedTransactionId: "merged",
        expectedVersion: 4,
      }),
    ).toEqual({ kind: "Unmerged", restoredTransactionIds: ["A", "B"] });

    const state = subject.snapshot();
    expect(
      state.find(({ transactionId }) => transactionId === "merged"),
    ).toMatchObject({ lifecycleState: "superseded" });
    const restored = state
      .filter(({ transactionId }) => ["A", "B"].includes(transactionId))
      .sort((left, right) => left.transactionId.localeCompare(right.transactionId));
    expect(
      restored.map(
        ({
          transactionId,
          lifecycleState,
          merchant,
          amountInWon,
          categoryId,
          memo,
          accountingDate,
          localTime,
          transactionType,
          cardDisplay,
          source,
          originChannel,
          creatorMemberId,
          captureLineageId,
          captureCardEvidence,
        }) => ({
          transactionId,
          lifecycleState,
          merchant,
          amountInWon,
          categoryId,
          memo,
          accountingDate,
          localTime,
          transactionType,
          cardDisplay,
          source,
          originChannel,
          creatorMemberId,
          captureLineageId,
          captureCardEvidence,
        }),
      ),
    ).toEqual([
      {
        ...leafA,
        lifecycleState: "active",
        accountingDate: "2026-07-20",
        localTime: "18:45",
        transactionType: "expense",
        cardDisplay: "현대카드(9999)",
      },
      {
        ...leafB,
        lifecycleState: "active",
        accountingDate: "2026-07-20",
        localTime: "18:45",
        transactionType: "expense",
        cardDisplay: "현대카드(9999)",
      },
    ]);
  });

  it.each([
    {
      name: "원본 ID가 없는 legacy mergedFrom",
      snapshots: [{ ...leafA, transactionId: undefined }, leafB],
    },
    {
      name: "capture lineage가 없는 legacy mergedFrom",
      snapshots: [{ ...leafA, captureLineageId: undefined }, leafB],
    },
    { name: "복원 snapshot 자체가 없음", snapshots: undefined },
  ])(
    "[T-MRG-002][MRG-002] $name은 추정 복원하지 않고 ContractFailure와 무변경 상태를 반환한다",
    async ({ snapshots }) => {
      const before = [storedLeaf(leafA), storedLeaf(leafB), merged(snapshots)];
      const subject = createSubject({ transactions: before });

      expect(
        await subject.unmerge({
          actor: { householdId: "household-1", memberId: "member-editor" },
          operationKey: "unmerge-legacy-incomplete",
          mergedTransactionId: "merged",
          expectedVersion: 4,
        }),
      ).toEqual({
        kind: "ContractFailure",
        code: "RESTORATION_SNAPSHOT_INCOMPLETE",
      });
      expect(subject.snapshot()).toEqual(before);
    },
  );
});

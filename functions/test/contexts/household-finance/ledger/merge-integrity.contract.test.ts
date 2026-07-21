import { describe, expect, it } from "vitest";
import { createMergeIntegrityFixtureSubject } from "../../../support/merge-integrity-fixture";

export interface MergeLeafSnapshot {
  transactionId: string;
  merchant: string;
  amountInWon: number;
  categoryId: string;
  memo: string;
  source: string;
  originChannel: string;
  creatorMemberId: string;
  captureLineageId: string;
}

export interface MergeTransaction {
  transactionId: string;
  householdId: string;
  lifecycleState: "active" | "superseded";
  merchant: string;
  amountInWon: number;
  categoryId: string;
  memo: string;
  accountingDate: string;
  localTime: string;
  transactionType: "expense";
  cardDisplay: string;
  source: string;
  originChannel: string;
  creatorMemberId: string;
  captureLineageId: string;
  aggregateVersion: number;
  mergeSnapshot?: readonly MergeLeafSnapshot[];
  mergeParentIds?: readonly string[];
}

export type MergeIntegrityResult =
  | { kind: "Merged"; transactionId: string; leafIds: readonly string[] }
  | {
      kind: "Conflict";
      code: "MERGE_LEAF_OVERLAP" | "MERGE_ANCESTRY_CYCLE" | "VERSION_MISMATCH";
    }
  | { kind: "ContractFailure"; code: "RESTORATION_SNAPSHOT_INCOMPLETE" }
  | { kind: "RetryableFailure"; code: "LEDGER_UOW_COMMIT_FAILED" };

export interface MergeIntegritySnapshot {
  transactions: readonly MergeTransaction[];
  events: readonly {
    eventName: "TransactionChanged.v1";
    transactionId: string;
  }[];
}

export interface MergeIntegrityContractSubject {
  merge(input: {
    actor: { householdId: string; memberId: string };
    operationKey: string;
    targetId: string;
    sourceIds: readonly string[];
    expectedVersions: Readonly<Record<string, number>>;
  }): Promise<MergeIntegrityResult>;
  snapshot(): MergeIntegritySnapshot;
}

export function createSubject(fixture: {
  transactions: readonly MergeTransaction[];
  failCommit?: boolean;
}): MergeIntegrityContractSubject {
  return createMergeIntegrityFixtureSubject(fixture);
}

function transaction(
  transactionId: string,
  amountInWon: number,
  overrides: Partial<MergeTransaction> = {},
): MergeTransaction {
  return {
    transactionId,
    householdId: "household-1",
    lifecycleState: "active",
    merchant: `가맹점-${transactionId}`,
    amountInWon,
    categoryId: `category-${transactionId}`,
    memo: `메모-${transactionId}`,
    accountingDate: "2026-07-20",
    localTime: "12:30",
    transactionType: "expense",
    cardDisplay: "국민카드(1234)",
    source: "android-notification",
    originChannel: "android",
    creatorMemberId: "member-1",
    captureLineageId: `lineage-${transactionId}`,
    aggregateVersion: 1,
    ...overrides,
  };
}

const actor = { householdId: "household-1", memberId: "member-1" };

describe("Ledger merge snapshot·graph·원자성 공개 계약", () => {
  it("[T-MRG-001][MRG-001/LED-009] merge는 대상 표시 필드와 합계를 유지하고 모든 leaf 복원 snapshot을 보존한다", async () => {
    const a = transaction("A", 1_000, {
      merchant: "대상 가맹점",
      categoryId: "target-category",
      memo: "대상 메모",
      accountingDate: "2026-07-21",
      localTime: "18:20",
      cardDisplay: "삼성카드(3333)",
    });
    const b = transaction("B", 2_000, {
      merchant: "원본 B",
      categoryId: "category-b",
      memo: "메모 B",
      source: "ios-shortcut",
      originChannel: "shortcut",
      creatorMemberId: "member-2",
    });
    const subject = createSubject({ transactions: [a, b] });

    const result = await subject.merge({
      actor,
      operationKey: "merge-ab",
      targetId: "A",
      sourceIds: ["B"],
      expectedVersions: { A: 1, B: 1 },
    });

    expect(result).toMatchObject({ kind: "Merged", leafIds: ["A", "B"] });
    const state = subject.snapshot();
    expect(
      state.transactions
        .filter(({ transactionId }) => ["A", "B"].includes(transactionId))
        .every(({ lifecycleState }) => lifecycleState === "superseded"),
    ).toBe(true);
    const merged = state.transactions.find(
      ({ transactionId }) => transactionId === (result.kind === "Merged" ? result.transactionId : ""),
    );
    expect(merged).toMatchObject({
      lifecycleState: "active",
      merchant: "대상 가맹점",
      amountInWon: 3_000,
      categoryId: "target-category",
      memo: "대상 메모",
      accountingDate: "2026-07-21",
      localTime: "18:20",
      transactionType: "expense",
      cardDisplay: "삼성카드(3333)",
      mergeSnapshot: [
        {
          transactionId: "A",
          merchant: "대상 가맹점",
          amountInWon: 1_000,
          categoryId: "target-category",
          memo: "대상 메모",
          source: "android-notification",
          originChannel: "android",
          creatorMemberId: "member-1",
          captureLineageId: "lineage-A",
        },
        {
          transactionId: "B",
          merchant: "원본 B",
          amountInWon: 2_000,
          categoryId: "category-b",
          memo: "메모 B",
          source: "ios-shortcut",
          originChannel: "shortcut",
          creatorMemberId: "member-2",
          captureLineageId: "lineage-B",
        },
      ],
    });
  });

  it("[T-MRG-001][MRG-001] 이미 포함된 leaf가 다시 입력되면 merge graph overlap을 전체 거부한다", async () => {
    const a = transaction("A", 1_000);
    const b = transaction("B", 2_000);
    const merged = transaction("M", 3_000, {
      mergeSnapshot: [
        {
          transactionId: "A",
          merchant: a.merchant,
          amountInWon: a.amountInWon,
          categoryId: a.categoryId,
          memo: a.memo,
          source: a.source,
          originChannel: a.originChannel,
          creatorMemberId: a.creatorMemberId,
          captureLineageId: a.captureLineageId,
        },
        {
          transactionId: "B",
          merchant: b.merchant,
          amountInWon: b.amountInWon,
          categoryId: b.categoryId,
          memo: b.memo,
          source: b.source,
          originChannel: b.originChannel,
          creatorMemberId: b.creatorMemberId,
          captureLineageId: b.captureLineageId,
        },
      ],
      mergeParentIds: ["A", "B"],
    });
    const before = [a, b, merged];
    const subject = createSubject({ transactions: before });

    expect(
      await subject.merge({
        actor,
        operationKey: "overlap",
        targetId: "M",
        sourceIds: ["A"],
        expectedVersions: { M: 1, A: 1 },
      }),
    ).toEqual({ kind: "Conflict", code: "MERGE_LEAF_OVERLAP" });
    expect(subject.snapshot()).toEqual({ transactions: before, events: [] });
  });

  it("[T-MRG-001][MRG-001] ancestry가 자기 자신으로 돌아오는 cycle은 임의 평탄화 없이 거부한다", async () => {
    const cyclic = transaction("M", 3_000, { mergeParentIds: ["N"] });
    const back = transaction("N", 2_000, { mergeParentIds: ["M"] });
    const before = [cyclic, back];
    const subject = createSubject({ transactions: before });

    expect(
      await subject.merge({
        actor,
        operationKey: "cycle",
        targetId: "M",
        sourceIds: ["N"],
        expectedVersions: { M: 1, N: 1 },
      }),
    ).toEqual({ kind: "Conflict", code: "MERGE_ANCESTRY_CYCLE" });
    expect(subject.snapshot()).toEqual({ transactions: before, events: [] });
  });

  it("[T-MRG-001][MRG-001] 중첩 merge의 leaf snapshot이 불완전하면 ContractFailure와 write 0건이다", async () => {
    const incomplete = transaction("M", 3_000, {
      mergeParentIds: ["A", "B"],
      mergeSnapshot: undefined,
    });
    const c = transaction("C", 1_000);
    const before = [incomplete, c];
    const subject = createSubject({ transactions: before });

    expect(
      await subject.merge({
        actor,
        operationKey: "incomplete-snapshot",
        targetId: "M",
        sourceIds: ["C"],
        expectedVersions: { M: 1, C: 1 },
      }),
    ).toEqual({
      kind: "ContractFailure",
      code: "RESTORATION_SNAPSHOT_INCOMPLETE",
    });
    expect(subject.snapshot()).toEqual({ transactions: before, events: [] });
  });

  it("[T-MRG-001][MRG-001/LED-008] merge UoW 실패는 원본 상태·snapshot·Event를 전부 rollback한다", async () => {
    const before = [transaction("A", 1_000), transaction("B", 2_000)];
    const subject = createSubject({ transactions: before, failCommit: true });

    expect(
      await subject.merge({
        actor,
        operationKey: "merge-uow-failure",
        targetId: "A",
        sourceIds: ["B"],
        expectedVersions: { A: 1, B: 1 },
      }),
    ).toEqual({
      kind: "RetryableFailure",
      code: "LEDGER_UOW_COMMIT_FAILED",
    });
    expect(subject.snapshot()).toEqual({ transactions: before, events: [] });
  });
});

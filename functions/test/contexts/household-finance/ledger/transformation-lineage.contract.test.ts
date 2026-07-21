import { describe, expect, it } from "vitest";
import { createTransformationLineageFixtureSubject } from "../../../support/transformation-lineage-fixture";

interface CaptureProvenance {
  source: string;
  originChannel: string;
  creatorMemberId: string;
  cardEvidence: string;
  captureLineageId: string;
  localCurrencyType?: string;
}

interface LedgerTransactionState {
  transactionId: string;
  lifecycleState: "active" | "superseded" | "deleted";
  amountInWon: number;
  merchant: string;
  categoryId: string;
  memo: string;
  accountingDate: string;
  localTime: string;
  cardDisplay: string;
  aggregateVersion: number;
  provenance: CaptureProvenance;
  mergeLeafIds?: readonly string[];
  intermediateMergeHistoryIds?: readonly string[];
}

interface LedgerContractState {
  transactions: readonly LedgerTransactionState[];
  dedupClaims: readonly {
    fingerprint: string;
    captureLineageId: string;
    state: "active" | "cancelled";
  }[];
  cancelledLineages: readonly {
    captureLineageId: string;
    fingerprint: string;
    cancelledAt: string;
    receiptRef: string;
  }[];
}

type LedgerMutationResult =
  | { kind: "success"; transactionIds: readonly string[] }
  | { kind: "conflict"; code: string }
  | { kind: "contract-failure"; code: string }
  | { kind: "retryable-failure"; code: string };

interface LedgerLineageFixture {
  transactions: readonly LedgerTransactionState[];
  dedupClaims: LedgerContractState["dedupClaims"];
}

export interface LedgerTransformationSubject {
  splitItems(command: {
    operationKey: string;
    sourceId: string;
    expectedVersion: number;
    items: readonly {
      amountInWon: number;
      merchant: string;
      categoryId: string;
      memo: string;
    }[];
  }): Promise<LedgerMutationResult>;
  merge(command: {
    operationKey: string;
    targetId: string;
    sourceIds: readonly string[];
    expectedVersions: Readonly<Record<string, number>>;
  }): Promise<LedgerMutationResult>;
  unmerge(command: {
    operationKey: string;
    mergedTransactionId: string;
    expectedVersion: number;
  }): Promise<LedgerMutationResult>;
  update(command: {
    operationKey: string;
    transactionId: string;
    expectedVersion: number;
    amountInWon: number;
  }): Promise<LedgerMutationResult>;
  cancelCapturedLineage(command: {
    cancellationKey: string;
    captureLineageId: string;
    expectedLineageVersion: number;
  }): Promise<LedgerMutationResult>;
  failNextCommitAtBoundary(): void;
  state(): LedgerContractState;
}

export function createSubject(
  fixture: LedgerLineageFixture,
): LedgerTransformationSubject {
  return createTransformationLineageFixtureSubject(fixture);
}

function captured(
  transactionId: string,
  amountInWon: number,
  lineageId: string,
  overrides: Partial<LedgerTransactionState> = {},
): LedgerTransactionState {
  return {
    transactionId,
    lifecycleState: "active",
    amountInWon,
    merchant: `merchant-${transactionId}`,
    categoryId: `category-${transactionId}`,
    memo: `memo-${transactionId}`,
    accountingDate: "2026-07-19",
    localTime: "10:00",
    cardDisplay: "국민(1234)",
    aggregateVersion: 1,
    provenance: {
      source: "android-notification",
      originChannel: "android",
      creatorMemberId: "member-1",
      cardEvidence: "KB:1234",
      captureLineageId: lineageId,
    },
    ...overrides,
  };
}

function fixture(
  transactions: readonly LedgerTransactionState[],
): LedgerLineageFixture {
  const byLineage = new Map(
    transactions.map((transaction) => [
      transaction.provenance.captureLineageId,
      transaction,
    ]),
  );

  return {
    transactions,
    dedupClaims: [...byLineage].map(([captureLineageId, transaction]) => ({
      fingerprint: `fingerprint-${transaction.transactionId}`,
      captureLineageId,
      state: "active" as const,
    })),
  };
}

describe("Ledger 구조 변경·capture lineage 공개 계약", () => {
  it("[T-LED-003][SPL-001/LED-009] item split은 원본을 같은 ID로 superseded 보존하고 모든 파생에 불변 provenance를 전달한다", async () => {
    const original = captured("original", 10_000, "lineage-a", {
      provenance: {
        source: "ios-shortcut",
        originChannel: "shortcut",
        creatorMemberId: "member-a",
        cardEvidence: "KB:9876",
        captureLineageId: "lineage-a",
        localCurrencyType: "gyeonggi",
      },
    });
    const subject = createSubject(fixture([original]));

    const result = await subject.splitItems({
      operationKey: "split-1",
      sourceId: "original",
      expectedVersion: 1,
      items: [
        { amountInWon: 4_000, merchant: "A", categoryId: "food", memo: "a" },
        { amountInWon: 6_000, merchant: "B", categoryId: "etc", memo: "b" },
      ],
    });

    expect(result.kind).toBe("success");
    const state = subject.state();
    const source = state.transactions.find(
      ({ transactionId }) => transactionId === "original",
    );
    const derived = state.transactions.filter(
      ({ transactionId }) => transactionId !== "original",
    );
    expect(source?.lifecycleState).toBe("superseded");
    expect(derived).toHaveLength(2);
    expect(derived.reduce((sum, item) => sum + item.amountInWon, 0)).toBe(10_000);
    expect(derived.every(({ lifecycleState }) => lifecycleState === "active")).toBe(
      true,
    );
    derived.forEach(({ provenance }) => {
      expect(provenance).toEqual(original.provenance);
    });
    expect(state.dedupClaims).toEqual(fixture([original]).dedupClaims);
  });

  it("[T-SPL-003][LED-008] commit 경계 실패는 원본·파생·claim을 모두 이전 상태로 유지한다", async () => {
    const original = captured("original", 10_000, "lineage-a");
    const initial = fixture([original]);
    const subject = createSubject(initial);
    subject.failNextCommitAtBoundary();

    const result = await subject.splitItems({
      operationKey: "split-fail",
      sourceId: "original",
      expectedVersion: 1,
      items: [
        { amountInWon: 5_000, merchant: "A", categoryId: "food", memo: "" },
        { amountInWon: 5_000, merchant: "B", categoryId: "food", memo: "" },
      ],
    });

    expect(result).toEqual({
      kind: "retryable-failure",
      code: "LEDGER_UOW_COMMIT_FAILED",
    });
    expect(subject.state()).toEqual({
      transactions: initial.transactions,
      dedupClaims: initial.dedupClaims,
      cancelledLineages: [],
    });
  });

  it("[T-LED-002][LED-005/LED-008] 같은 version의 Update와 Split은 하나만 commit하고 stale 요청은 덮어쓰지 않는다", async () => {
    const original = captured("original", 10_000, "lineage-a");
    const subject = createSubject(fixture([original]));

    const results = await Promise.all([
      subject.update({
        operationKey: "update",
        transactionId: "original",
        expectedVersion: 1,
        amountInWon: 12_000,
      }),
      subject.splitItems({
        operationKey: "split",
        sourceId: "original",
        expectedVersion: 1,
        items: [
          { amountInWon: 4_000, merchant: "A", categoryId: "food", memo: "" },
          { amountInWon: 6_000, merchant: "B", categoryId: "food", memo: "" },
        ],
      }),
    ]);

    expect(results.filter(({ kind }) => kind === "success")).toHaveLength(1);
    expect(results.filter(({ kind }) => kind === "conflict")).toEqual([
      { kind: "conflict", code: "VERSION_MISMATCH" },
    ]);
    const active = subject
      .state()
      .transactions.filter(({ lifecycleState }) => lifecycleState === "active");
    expect(
      active.length === 1 && active[0].amountInWon === 12_000
        ? true
        : active.reduce((sum, item) => sum + item.amountInWon, 0) === 10_000,
    ).toBe(true);
  });

  it("[T-MRG-001][DEC-056] A+B=M 뒤 M+C=N은 A·B·C leaf로 평탄화하고 중간 M은 감사 이력으로만 보존한다", async () => {
    const subject = createSubject(
      fixture([
        captured("A", 1_000, "lineage-a"),
        captured("B", 2_000, "lineage-b"),
        captured("C", 3_000, "lineage-c"),
      ]),
    );
    const first = await subject.merge({
      operationKey: "merge-ab",
      targetId: "A",
      sourceIds: ["B"],
      expectedVersions: { A: 1, B: 1 },
    });
    const mergedId = first.kind === "success" ? first.transactionIds[0] : "";

    const second = await subject.merge({
      operationKey: "merge-abc",
      targetId: mergedId,
      sourceIds: ["C"],
      expectedVersions: { [mergedId]: 1, C: 1 },
    });

    expect(second.kind).toBe("success");
    const finalId = second.kind === "success" ? second.transactionIds[0] : "";
    const final = subject
      .state()
      .transactions.find(({ transactionId }) => transactionId === finalId);
    expect(final).toMatchObject({
      amountInWon: 6_000,
      mergeLeafIds: ["A", "B", "C"],
      intermediateMergeHistoryIds: [mergedId],
    });
    expect(
      subject
        .state()
        .transactions.find(({ transactionId }) => transactionId === mergedId)
        ?.lifecycleState,
    ).toBe("superseded");
  });

  it("[T-MRG-001][LED-010/DEC-057] 서로 다른 지역화폐 유형이나 typed·untyped 혼합 merge는 write 0건이다", async () => {
    const a = captured("A", 1_000, "lineage-a", {
      provenance: {
        ...captured("A", 1_000, "lineage-a").provenance,
        localCurrencyType: "gyeonggi",
      },
    });
    const b = captured("B", 2_000, "lineage-b", {
      provenance: {
        ...captured("B", 2_000, "lineage-b").provenance,
        localCurrencyType: "sejong",
      },
    });
    const initial = fixture([a, b]);
    const subject = createSubject(initial);

    const result = await subject.merge({
      operationKey: "merge-types",
      targetId: "A",
      sourceIds: ["B"],
      expectedVersions: { A: 1, B: 1 },
    });

    expect(result).toEqual({
      kind: "conflict",
      code: "LOCAL_CURRENCY_TYPE_MISMATCH",
    });
    expect(subject.state().transactions).toEqual(initial.transactions);
  });

  it("[T-MRG-002][DEC-010/DEC-056] unmerge는 중간 merge가 아니라 같은 A·B·C ID와 원본별 표시값을 복원한다", async () => {
    const a = captured("A", 1_000, "lineage-a", { merchant: "원본 A" });
    const b = captured("B", 2_000, "lineage-b", { merchant: "원본 B" });
    const c = captured("C", 3_000, "lineage-c", { merchant: "원본 C" });
    const subject = createSubject(fixture([a, b, c]));
    const first = await subject.merge({
      operationKey: "merge-ab",
      targetId: "A",
      sourceIds: ["B"],
      expectedVersions: { A: 1, B: 1 },
    });
    const m = first.kind === "success" ? first.transactionIds[0] : "";
    const second = await subject.merge({
      operationKey: "merge-abc",
      targetId: m,
      sourceIds: ["C"],
      expectedVersions: { [m]: 1, C: 1 },
    });
    const n = second.kind === "success" ? second.transactionIds[0] : "";

    const unmerged = await subject.unmerge({
      operationKey: "unmerge-abc",
      mergedTransactionId: n,
      expectedVersion: 1,
    });

    expect(unmerged).toEqual({
      kind: "success",
      transactionIds: ["A", "B", "C"],
    });
    const restored = subject
      .state()
      .transactions.filter(({ transactionId }) => ["A", "B", "C"].includes(transactionId))
      .sort((left, right) => left.transactionId.localeCompare(right.transactionId));
    expect(restored.map(({ merchant }) => merchant)).toEqual([
      "원본 A",
      "원본 B",
      "원본 C",
    ]);
    expect(restored.map(({ provenance }) => provenance.captureLineageId)).toEqual([
      "lineage-a",
      "lineage-b",
      "lineage-c",
    ]);
    expect(restored.every(({ lifecycleState }) => lifecycleState === "active")).toBe(true);
  });

  it("[T-LED-003][T-CAPTURE-LINEAGE-001][DEC-041] 합쳐진 한 lineage 취소는 대상 전체를 지우고 다른 lineage 원본을 복원하며 최소 tombstone만 남긴다", async () => {
    const a = captured("A", 1_000, "lineage-a");
    const b = captured("B", 2_000, "lineage-b");
    const subject = createSubject(fixture([a, b]));
    await subject.merge({
      operationKey: "merge-ab",
      targetId: "A",
      sourceIds: ["B"],
      expectedVersions: { A: 1, B: 1 },
    });

    const result = await subject.cancelCapturedLineage({
      cancellationKey: "cancel-a",
      captureLineageId: "lineage-a",
      expectedLineageVersion: 2,
    });

    expect(result.kind).toBe("success");
    const state = subject.state();
    expect(
      state.transactions.filter(
        ({ provenance }) => provenance.captureLineageId === "lineage-a",
      ),
    ).toEqual([]);
    expect(
      state.transactions.find(({ transactionId }) => transactionId === "B"),
    ).toMatchObject({ lifecycleState: "active", amountInWon: 2_000 });
    expect(state.cancelledLineages).toEqual([
      {
        captureLineageId: "lineage-a",
        fingerprint: "fingerprint-A",
        cancelledAt: expect.any(String),
        receiptRef: expect.any(String),
      },
    ]);
    expect(JSON.stringify(state.cancelledLineages)).not.toMatch(
      /merchant|amount|card|memo/i,
    );
  });
});

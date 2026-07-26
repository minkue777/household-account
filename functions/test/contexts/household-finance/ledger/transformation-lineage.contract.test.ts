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
  transactionType: "expense" | "income";
  lifecycleState: "active" | "superseded" | "deleted";
  amountInWon: number;
  merchant: string;
  categoryId: string;
  memo: string;
  accountingDate: string;
  localTime: string;
  cardDisplay: string;
  cardType: string;
  aggregateVersion: number;
  provenance: CaptureProvenance;
  legacyMergeSnapshotPresent?: boolean;
  mergeLeafIds?: readonly string[];
  intermediateMergeHistoryIds?: readonly string[];
  splitGroupId?: string;
  splitIndex?: number;
  splitTotal?: number;
  splitOriginalId?: string;
  derivedFromTransactionId?: string;
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
  | {
      kind: "success";
      transactionIds: readonly string[];
      transactions?: readonly LedgerTransactionState[];
    }
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
  loadSelections(): readonly {
    transactionIds?: readonly string[];
    captureLineageIds?: readonly string[];
    mergeLeafIds?: readonly string[];
  }[];
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
    transactionType: "expense",
    lifecycleState: "active",
    amountInWon,
    merchant: `merchant-${transactionId}`,
    categoryId: `category-${transactionId}`,
    memo: `memo-${transactionId}`,
    accountingDate: "2026-07-19",
    localTime: "10:00",
    cardDisplay: "국민(1234)",
    cardType: "captured",
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

  it("병합은 대상과 원본 ID만 선택 조회하고 무관한 거래를 읽지 않는다", async () => {
    const unrelated = Array.from({ length: 50 }, (_, index) =>
      captured(`unrelated-${index}`, index + 1, `lineage-unrelated-${index}`),
    );
    const subject = createSubject(
      fixture([
        captured("A", 1_000, "lineage-a"),
        captured("B", 2_000, "lineage-b"),
        ...unrelated,
      ]),
    );

    const result = await subject.merge({
      operationKey: "targeted-merge",
      targetId: "A",
      sourceIds: ["B"],
      expectedVersions: { A: 1, B: 1 },
    });

    expect(result.kind).toBe("success");
    expect(subject.loadSelections()).toEqual([
      { transactionIds: ["A", "B"] },
    ]);
  });

  it("수입 거래가 하나라도 포함된 병합은 쓰기 없이 거절한다", async () => {
    const income = captured("income", 1_000, "lineage-income", {
      transactionType: "income",
    });
    const expense = captured("expense", 2_000, "lineage-expense");
    const initial = fixture([income, expense]);
    const subject = createSubject(initial);

    const result = await subject.merge({
      operationKey: "merge-income",
      targetId: "income",
      sourceIds: ["expense"],
      expectedVersions: { income: 1, expense: 1 },
    });

    expect(result).toEqual({ kind: "conflict", code: "MERGE_EXPENSE_ONLY" });
    expect(subject.state().transactions).toEqual(initial.transactions);
  });

  it("mergedFrom은 있지만 mergeLeafIds가 없는 legacy 병합 입력은 fail-closed로 거절한다", async () => {
    const legacyMerged = captured("legacy-merged", 3_000, "lineage-a", {
      legacyMergeSnapshotPresent: true,
    });
    const source = captured("source", 2_000, "lineage-b");
    const initial = fixture([legacyMerged, source]);
    const subject = createSubject(initial);

    const result = await subject.merge({
      operationKey: "legacy-incomplete-merge",
      targetId: "legacy-merged",
      sourceIds: ["source"],
      expectedVersions: { "legacy-merged": 1, source: 1 },
    });

    expect(result).toEqual({
      kind: "contract-failure",
      code: "RESTORATION_SNAPSHOT_INCOMPLETE",
    });
    expect(subject.state().transactions).toEqual(initial.transactions);
  });

  it("병합 leaf가 자기 자신이나 중간 병합 aggregate를 가리키면 cycle conflict로 무변경 종료한다", async () => {
    const selfCycle = fixture([
      captured("M", 1_000, "lineage-m", { mergeLeafIds: ["M"] }),
      captured("X", 2_000, "lineage-x"),
    ]);
    const selfCycleSubject = createSubject(selfCycle);

    expect(
      await selfCycleSubject.merge({
        operationKey: "self-cycle",
        targetId: "M",
        sourceIds: ["X"],
        expectedVersions: { M: 1, X: 1 },
      }),
    ).toEqual({ kind: "conflict", code: "MERGE_ANCESTRY_CYCLE" });
    expect(selfCycleSubject.state().transactions).toEqual(
      selfCycle.transactions,
    );

    const intermediateCycle = fixture([
      captured("A", 1_000, "lineage-a"),
      captured("B", 2_000, "lineage-b"),
      captured("C", 3_000, "lineage-c"),
      captured("N", 5_000, "lineage-n", { mergeLeafIds: ["B", "C"] }),
      captured("M", 6_000, "lineage-m", { mergeLeafIds: ["A", "N"] }),
      captured("X", 4_000, "lineage-x"),
    ]);
    const intermediateSubject = createSubject(intermediateCycle);

    expect(
      await intermediateSubject.merge({
        operationKey: "intermediate-cycle",
        targetId: "M",
        sourceIds: ["X"],
        expectedVersions: { M: 1, X: 1 },
      }),
    ).toEqual({ kind: "conflict", code: "MERGE_ANCESTRY_CYCLE" });
    expect(intermediateSubject.state().transactions).toEqual(
      intermediateCycle.transactions,
    );
  });

  it.each(["intermediate", "legacy", "duplicate"] as const)(
    "병합 해제 leaf가 $caseKind이면 restoration snapshot 불완전으로 무변경 거절한다",
    async (caseKind) => {
      const leafA = captured("A", 1_000, "lineage-a", {
        lifecycleState: "superseded",
      });
      const suspect = captured("S", 2_000, "lineage-s", {
        lifecycleState: "superseded",
        ...(caseKind === "intermediate"
          ? { mergeLeafIds: ["B", "C"] }
          : caseKind === "legacy"
            ? { legacyMergeSnapshotPresent: true }
            : {}),
      });
      const merged = captured("M", 3_000, "lineage-m", {
        mergeLeafIds:
          caseKind === "duplicate" ? ["A", "A"] : ["A", "S"],
      });
      const initial = fixture([leafA, suspect, merged]);
      const subject = createSubject(initial);

      const result = await subject.unmerge({
        operationKey: `unmerge-invalid-${caseKind}`,
        mergedTransactionId: "M",
        expectedVersion: 1,
      });

      expect(result).toEqual({
        kind: "contract-failure",
        code: "RESTORATION_SNAPSHOT_INCOMPLETE",
      });
      expect(subject.state().transactions).toEqual(initial.transactions);
    },
  );

  it("[DEC-010] 병합 해제는 원본 상세와 병합 거래의 공통 표시 필드를 함께 복원한다", async () => {
    const leafA = captured("A", 1_000, "lineage-a", {
      lifecycleState: "superseded",
      merchant: "원본 A",
      categoryId: "food",
      memo: "메모 A",
      accountingDate: "2026-01-01",
      localTime: "01:00",
      transactionType: "income",
      cardType: "old-a",
      cardDisplay: "이전 A",
    });
    const leafB = captured("B", 2_000, "lineage-b", {
      lifecycleState: "superseded",
      merchant: "원본 B",
      categoryId: "etc",
      memo: "메모 B",
      accountingDate: "2026-02-02",
      localTime: "02:00",
      cardType: "old-b",
      cardDisplay: "이전 B",
    });
    const merged = captured("M", 3_000, "lineage-merged", {
      accountingDate: "2026-07-25",
      localTime: "21:35",
      transactionType: "expense",
      cardType: "local_currency",
      cardDisplay: "지역화폐(9876)",
      mergeLeafIds: ["A", "B"],
    });
    const subject = createSubject(fixture([leafA, leafB, merged]));

    const result = await subject.unmerge({
      operationKey: "unmerge-common-fields",
      mergedTransactionId: "M",
      expectedVersion: 1,
    });

    expect(result).toEqual({
      kind: "success",
      transactionIds: ["A", "B"],
    });
    const restored = subject
      .state()
      .transactions.filter(({ transactionId }) => ["A", "B"].includes(transactionId));
    expect(restored).toEqual([
      expect.objectContaining({
        transactionId: "A",
        merchant: "원본 A",
        categoryId: "food",
        memo: "메모 A",
        accountingDate: "2026-07-25",
        localTime: "21:35",
        transactionType: "expense",
        cardType: "local_currency",
        cardDisplay: "지역화폐(9876)",
      }),
      expect.objectContaining({
        transactionId: "B",
        merchant: "원본 B",
        categoryId: "etc",
        memo: "메모 B",
        accountingDate: "2026-07-25",
        localTime: "21:35",
        transactionType: "expense",
        cardType: "local_currency",
        cardDisplay: "지역화폐(9876)",
      }),
    ]);
  });

  it.each([
    { captureLineageId: "lineage-b", restoredIds: ["A", "C"] },
    { captureLineageId: "lineage-c", restoredIds: ["A", "B"] },
  ])(
    "$captureLineageId 취소는 해당 source leaf를 참조하는 병합 거래를 찾아 제거하고 나머지 leaf를 복원한다",
    async ({ captureLineageId, restoredIds }) => {
      const subject = createSubject(
        fixture([
          captured("A", 1_000, "lineage-a"),
          captured("B", 2_000, "lineage-b"),
          captured("C", 3_000, "lineage-c"),
        ]),
      );
      const first = await subject.merge({
        operationKey: "merge-ab-for-cancel",
        targetId: "A",
        sourceIds: ["B"],
        expectedVersions: { A: 1, B: 1 },
      });
      const mergedAB = first.kind === "success" ? first.transactionIds[0] : "";
      await subject.merge({
        operationKey: "merge-abc-for-cancel",
        targetId: mergedAB,
        sourceIds: ["C"],
        expectedVersions: { [mergedAB]: 1, C: 1 },
      });

      const result = await subject.cancelCapturedLineage({
        cancellationKey: `cancel-${captureLineageId}`,
        captureLineageId,
        expectedLineageVersion: 2,
      });

      expect(result).toEqual({
        kind: "success",
        transactionIds: restoredIds,
      });
      const activeIds = subject
        .state()
        .transactions.filter(({ lifecycleState }) => lifecycleState === "active")
        .map(({ transactionId }) => transactionId)
        .sort();
      expect(activeIds).toEqual([...restoredIds].sort());
    },
  );

  it("취소 대상 병합의 비취소 leaf가 없으면 전체 취소를 fail-closed로 무변경 종료한다", async () => {
    const leaf = captured("A", 1_000, "lineage-a", {
      lifecycleState: "superseded",
    });
    const merged = captured("M", 3_000, "lineage-a", {
      mergeLeafIds: ["A", "missing-B"],
    });
    const initial = fixture([leaf, merged]);
    const subject = createSubject(initial);

    const result = await subject.cancelCapturedLineage({
      cancellationKey: "cancel-missing-leaf",
      captureLineageId: "lineage-a",
      expectedLineageVersion: 1,
    });

    expect(result).toEqual({
      kind: "contract-failure",
      code: "RESTORATION_SNAPSHOT_INCOMPLETE",
    });
    expect(subject.state().transactions).toEqual(initial.transactions);
    expect(subject.state().dedupClaims).toEqual(initial.dedupClaims);
  });

  it("가구의 활성 legacy 병합 복원 정보가 하나라도 불완전하면 취소 전체를 막는다", async () => {
    const initial = fixture([
      captured("A", 1_000, "lineage-a"),
      captured("legacy-M", 2_000, "lineage-legacy", {
        lifecycleState: "superseded",
        legacyMergeSnapshotPresent: true,
      }),
    ]);
    const subject = createSubject(initial);

    const result = await subject.cancelCapturedLineage({
      cancellationKey: "cancel-with-incomplete-household-merge",
      captureLineageId: "lineage-a",
      expectedLineageVersion: 1,
    });

    expect(result).toEqual({
      kind: "contract-failure",
      code: "RESTORATION_SNAPSHOT_INCOMPLETE",
    });
    expect(subject.state().transactions).toEqual(initial.transactions);
    expect(subject.state().dedupClaims).toEqual(initial.dedupClaims);
    expect(subject.loadSelections()).toEqual([]);
  });

  it("삭제된 과거 병합은 일반 삭제된 leaf를 취소 복원하지 않는다", async () => {
    const subject = createSubject(
      fixture([
        captured("A", 1_000, "lineage-a", { aggregateVersion: 3 }),
        captured("B", 2_000, "lineage-b", {
          lifecycleState: "deleted",
          aggregateVersion: 4,
        }),
        captured("M", 3_000, "lineage-a", {
          lifecycleState: "deleted",
          aggregateVersion: 2,
          mergeLeafIds: ["A", "B"],
        }),
      ]),
    );

    const result = await subject.cancelCapturedLineage({
      cancellationKey: "cancel-after-unmerge-and-manual-delete",
      captureLineageId: "lineage-a",
      expectedLineageVersion: 3,
    });

    expect(result).toEqual({ kind: "success", transactionIds: [] });
    expect(subject.state().transactions).toEqual([
      expect.objectContaining({
        transactionId: "B",
        lifecycleState: "deleted",
        aggregateVersion: 4,
      }),
    ]);
  });

  it("삭제된 불완전 legacy 병합 이력은 현재 취소를 과잉 차단하지 않는다", async () => {
    const subject = createSubject(
      fixture([
        captured("A", 1_000, "lineage-a"),
        captured("legacy-deleted-M", 2_000, "lineage-legacy", {
          lifecycleState: "deleted",
          legacyMergeSnapshotPresent: true,
        }),
      ]),
    );

    const result = await subject.cancelCapturedLineage({
      cancellationKey: "cancel-with-deleted-incomplete-history",
      captureLineageId: "lineage-a",
      expectedLineageVersion: 1,
    });

    expect(result).toEqual({ kind: "success", transactionIds: [] });
    expect(subject.state().transactions).toEqual([
      expect.objectContaining({
        transactionId: "legacy-deleted-M",
        lifecycleState: "deleted",
      }),
    ]);
  });
});

import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { FirebaseCaptureLedgerPersistence } from "../../../src/adapters/firebase/payment-capture/firebaseCaptureLedgerPersistence";
import type {
  CaptureApprovalPersistenceCommand,
  CaptureCancellationPersistenceCommand,
} from "../../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureLedgerPersistencePort";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

function approval(
  label = "A",
  amountInWon = 12_000,
): CaptureApprovalPersistenceCommand {
  return {
    householdId: "house-1",
    downstreamKey: `approval-${label}`,
    branch: {
      observationId: `observation-approval-${label}`,
      originChannel: "android-notification",
      creatorMemberId: "member-1",
      sourceType: "kb-card",
      parser: { parserId: "kb-card-parser", parserVersion: "2.0.0" },
      rawPayloadHash: `sha256:${label.toLowerCase().repeat(64).slice(0, 64)}`,
      occurredAt: `2026-07-21T10:${label === "A" ? "01" : "02"}:00+09:00`,
      accountingDate: "2026-07-21",
      amountInWon,
      originalMerchant: `merchant-${label}`,
      merchant: `merchant-${label}`,
      categoryId: "etc",
      memo: "",
      cardEvidence: { companyLabel: "KB", maskedToken: "1234" },
      canonicalCardId: `card-${label}`,
    },
  };
}

function cancellationFor(
  approved: CaptureApprovalPersistenceCommand,
  key: string,
): CaptureCancellationPersistenceCommand {
  return {
    householdId: approved.householdId,
    downstreamKey: `cancellation-${key}`,
    branch: {
      observationId: `observation-cancellation-${key}`,
      creatorMemberId: approved.branch.creatorMemberId,
      sourceType: approved.branch.sourceType,
      parser: approved.branch.parser,
      rawPayloadHash: `sha256:${"c".repeat(64)}`,
      observedAt: "2026-07-22T09:00:00+09:00",
      cancellationDate: "2026-07-22",
      amountInWon: approved.branch.amountInWon,
      merchant: approved.branch.merchant,
      cardEvidence: approved.branch.cardEvidence,
      canonicalCardId: approved.branch.canonicalCardId,
    },
  };
}

function subject(memory: InMemoryFirestore) {
  return new FirebaseCaptureLedgerPersistence(
    memory as unknown as firestore.Firestore,
  );
}

describe("Firebase capture cancellation safety", () => {
  it.each([10_000, 10_001, 10_002])("[T-CAN-006][CAN-006] 원승인 증거 없는 구형 5,000원×2 그룹은 %s원 취소가 와도 추정 삭제하지 않는다", async (amount) => {
    const memory = new InMemoryFirestore();
    const persistence = subject(memory);
    const command = approval("A", amount);
    for (const index of [1, 2]) {
      const old = { householdId: "house-1", date: index === 1 ? "2026-07-21" : "2026-08-21", time: "10:01", amount: 5_000, merchant: `merchant-A (${index}/2)`, cardLastFour: "KB(1234)", splitGroupId: "legacy-group", splitIndex: index, splitTotal: 2 };
      memory.seed(`expenses/legacy-part-${index}`, old);
      // 기존 migration은 원승인 증거 없이 식별용 legacy ID만 채울 수 있습니다.
      memory.seed(`households/house-1/ledgerTransactions/legacy-part-${index}`, { ...old, amountInWon: 5_000, captureLineageId: `legacy:legacy-part-${index}` });
    }
    const legacyBefore = memory.documentsInCollection("expenses");
    const canonicalBefore = memory.documentsInCollection("households/house-1/ledgerTransactions");
    const cancellation = cancellationFor(command, "legacy-split");
    const result = await persistence.cancel(cancellation);
    expect(result).toEqual({ kind: "notFound", resource: "cancellationTarget" });
    expect(await persistence.cancel(cancellation)).toEqual(result);
    expect(memory.documentsInCollection("expenses")).toEqual(legacyBefore);
    expect(memory.documentsInCollection("households/house-1/ledgerTransactions")).toEqual(canonicalBefore);
    expect(memory.paths("households/house-1/captureRecords/")).toEqual([]);
    expect(memory.paths("households/house-1/ledgerDedupKeys/")).toEqual([]);
    expect(memory.paths("outboxEvents/")).toEqual([]);
    expect(memory.paths("commandReceipts/payment-capture-ledger/receipts/")).toHaveLength(1);
  });

  it("[CAN-003][ING-008] 총액 필드가 없던 승인 receipt도 배포 후 재생하며 과거 캐시백 총액을 추정하지 않는다", async () => {
    const memory = new InMemoryFirestore();
    const persistence = subject(memory);
    const oldCommand = approval("A", 9_500);
    const first = await persistence.recordApproval(oldCommand);
    const newCommand = { ...oldCommand, branch: { ...oldCommand.branch, approvalAmountInWon: 10_000 } };
    const recordsBefore = memory.documentsInCollection("households/house-1/captureRecords");
    expect(first.kind).toBe("recorded");
    expect(await persistence.recordApproval(newCommand)).toEqual(first);
    expect(memory.documentsInCollection("households/house-1/captureRecords")).toEqual(recordsBefore);
    const cancellation = cancellationFor(oldCommand, "old-cashback");
    expect(await persistence.cancel({ ...cancellation, branch: { ...cancellation.branch, amountInWon: 10_000 } })).toEqual({ kind: "notFound", resource: "cancellationTarget" });
    expect(memory.documentsInCollection("households/house-1/ledgerTransactions")).toHaveLength(1);
  });

  it.each([null, "10000", 9_000])("[CAN-003] 잘못된 승인 총액 %s를 순액으로 대체해 취소하지 않는다", async (invalidAmount) => {
    const memory = new InMemoryFirestore();
    const persistence = subject(memory);
    const command = approval("A", 9_500);
    await persistence.recordApproval(command);
    const record = memory.documentsInCollection("households/house-1/captureRecords")[0];
    memory.seed(record.path, { ...record.value, approvalAmountInWon: invalidAmount });
    expect(await persistence.cancel(cancellationFor(command, "invalid-gross"))).toEqual({ kind: "notFound", resource: "cancellationTarget" });
    expect(memory.documentsInCollection("households/house-1/ledgerTransactions")).toHaveLength(1);
  });

  it("[CAN-001][CAN-002] 표시 가맹점 변경과 관계없이 원 증거로 취소하며 최소 tombstone만 남기고 replay는 원장 query를 하지 않는다", async () => {
    const memory = new InMemoryFirestore();
    const persistence = subject(memory);
    const initialApproval = approval();
    const approved = { ...initialApproval, branch: { ...initialApproval.branch, merchant: "old mapping" } };
    const created = await persistence.recordApproval(approved);
    if (created.kind !== "recorded") throw new Error("APPROVAL_REQUIRED");
    const initialCancellation = cancellationFor(approved, "mapped");
    const cancellation = { ...initialCancellation, branch: { ...initialCancellation.branch, merchant: "new mapping", originalMerchant: approved.branch.originalMerchant } };
    const result = await persistence.cancel(cancellation);
    expect(result.kind).toBe("cancelled");
    for (const { value } of memory.documentsInCollection("households/house-1/captureRecords")) {
      for (const field of ["amountInWon", "originalMerchant", "merchant", "cardEvidence", "rawPayloadHash", "parser", "creatorMemberId"]) expect(value).not.toHaveProperty(field);
    }
    memory.clearTransactionReads();
    expect(await persistence.cancel(cancellation)).toEqual(result);
    expect(memory.transactionReads().filter((read) => read.kind === "query")).toEqual([]);
  });
  it("capture record의 원거래가 유실되면 notFound receipt만 기록한다", async () => {
    const memory = new InMemoryFirestore();
    const persistence = subject(memory);
    const command = approval();
    const created = await persistence.recordApproval(command);
    if (created.kind !== "recorded") throw new Error("APPROVAL_REQUIRED");
    memory.remove(
      `households/house-1/ledgerTransactions/${created.transactionId}`,
    );
    memory.remove(`expenses/${created.transactionId}`);
    const claimPath = memory.paths("households/house-1/ledgerDedupKeys/")[0];
    const capturePath = memory.paths("households/house-1/captureRecords/")[0];
    const claimBefore = memory.document(claimPath);
    const captureBefore = memory.document(capturePath);
    const outboxBefore = memory.paths("outboxEvents/");
    const receiptCountBefore = memory.paths(
      "commandReceipts/payment-capture-ledger/receipts/",
    ).length;

    const result = await persistence.cancel(cancellationFor(command, "missing"));

    expect(result).toEqual({
      kind: "notFound",
      resource: "cancellationTarget",
    });
    expect(memory.document(claimPath)).toEqual(claimBefore);
    expect(memory.document(capturePath)).toEqual(captureBefore);
    expect(memory.paths("outboxEvents/")).toEqual(outboxBefore);
    expect(
      memory.paths("commandReceipts/payment-capture-ledger/receipts/"),
    ).toHaveLength(receiptCountBefore + 1);
  });

  it("원거래가 선택된 capture lineage를 포함하지 않으면 notFound로 끝낸다", async () => {
    const memory = new InMemoryFirestore();
    const persistence = subject(memory);
    const command = approval();
    const created = await persistence.recordApproval(command);
    if (created.kind !== "recorded") throw new Error("APPROVAL_REQUIRED");
    for (const path of [
      `households/house-1/ledgerTransactions/${created.transactionId}`,
      `expenses/${created.transactionId}`,
    ]) {
      const stored = memory.document(path);
      if (stored === undefined) throw new Error("TRANSACTION_REQUIRED");
      memory.seed(path, { ...stored, captureLineageId: "other-lineage" });
    }
    const outboxCount = memory.paths("outboxEvents/").length;

    const result = await persistence.cancel(
      cancellationFor(command, "wrong-lineage"),
    );

    expect(result).toEqual({
      kind: "notFound",
      resource: "cancellationTarget",
    });
    expect(memory.paths("outboxEvents/")).toHaveLength(outboxCount);
    const claim = memory.document(
      memory.paths("households/house-1/ledgerDedupKeys/")[0],
    );
    expect(claim).toMatchObject({ state: "active" });
  });

  it("legacy sourceFingerprint만 남은 원거래도 같은 lineage로 취소한다", async () => {
    const memory = new InMemoryFirestore();
    const persistence = subject(memory);
    const command = approval();
    const created = await persistence.recordApproval(command);
    if (created.kind !== "recorded") throw new Error("APPROVAL_REQUIRED");
    for (const path of [
      `households/house-1/ledgerTransactions/${created.transactionId}`,
      `expenses/${created.transactionId}`,
    ]) {
      const stored = memory.document(path);
      if (stored === undefined) throw new Error("TRANSACTION_REQUIRED");
      delete stored.captureLineageId;
      memory.seed(path, {
        ...stored,
        sourceFingerprint: created.captureLineageId,
      });
    }

    const result = await persistence.cancel(
      cancellationFor(command, "source-fingerprint"),
    );

    expect(result).toEqual({
      kind: "cancelled",
      transactionIds: [created.transactionId],
    });
  });

  it("[T-CAN-003][CAN-004] 무관한 active legacy merge는 승인 취소를 막지 않고 그대로 보존한다", async () => {
    const memory = new InMemoryFirestore();
    const persistence = subject(memory);
    const command = approval();
    const created = await persistence.recordApproval(command);
    if (created.kind !== "recorded") throw new Error("APPROVAL_REQUIRED");
    const unrelatedId = "unrelated-incomplete-legacy-merge";
    const unrelatedMerge = {
      householdId: "house-1",
      lifecycleState: "active",
      aggregateVersion: 1,
      mergedFrom: [{ merchant: "legacy leaf", amount: 1_000 }],
    };
    memory.seed(
      `households/house-1/ledgerTransactions/${unrelatedId}`,
      unrelatedMerge,
    );
    memory.seed(`expenses/${unrelatedId}`, unrelatedMerge);

    const result = await persistence.cancel(
      cancellationFor(command, "unrelated-incomplete-legacy-merge"),
    );

    expect(result).toEqual({
      kind: "cancelled",
      transactionIds: [created.transactionId],
    });
    expect(
      memory.document(
        `households/house-1/ledgerTransactions/${unrelatedId}`,
      ),
    ).toEqual(unrelatedMerge);
    expect(memory.document(`expenses/${unrelatedId}`)).toEqual(unrelatedMerge);
  });

  it("대상 lineage에 연결된 active 병합의 복원 ID가 없으면 취소 전체를 막는다", async () => {
    const memory = new InMemoryFirestore();
    const persistence = subject(memory);
    const command = approval();
    const created = await persistence.recordApproval(command);
    if (created.kind !== "recorded") throw new Error("APPROVAL_REQUIRED");
    memory.seed("households/house-1/ledgerTransactions/incomplete-merge", {
      householdId: "house-1",
      lifecycleState: "active",
      captureLineageId: created.captureLineageId,
      mergedFrom: [{ merchant: "legacy leaf", amount: 1_000 }],
      mergeLeafIds: [],
    });
    const outboxCount = memory.paths("outboxEvents/").length;
    const receiptCount = memory.paths(
      "commandReceipts/payment-capture-ledger/receipts/",
    ).length;

    const result = await persistence.cancel(
      cancellationFor(command, "incomplete-merge"),
    );

    expect(result).toEqual({
      kind: "rejected",
      code: "RESTORATION_SNAPSHOT_INCOMPLETE",
    });
    expect(memory.paths("outboxEvents/")).toHaveLength(outboxCount);
    expect(
      memory.paths("commandReceipts/payment-capture-ledger/receipts/"),
    ).toHaveLength(receiptCount);
    expect(
      memory.document(
        `households/house-1/ledgerTransactions/${created.transactionId}`,
      ),
    ).toMatchObject({ lifecycleState: "active" });
  });

  it("유효한 canonical 병합은 stale legacy projection 누락으로 차단하지 않는다", async () => {
    const memory = new InMemoryFirestore();
    const persistence = subject(memory);
    const command = approval();
    const created = await persistence.recordApproval(command);
    if (created.kind !== "recorded") throw new Error("APPROVAL_REQUIRED");
    const projectionId = "projection-merge";
    memory.seed(`expenses/${projectionId}`, {
      householdId: "house-1",
      lifecycleState: "active",
      mergedFrom: [{ merchant: "legacy leaf", amount: 1_000 }],
    });
    memory.seed(
      `households/house-1/ledgerTransactions/${projectionId}`,
      {
        householdId: "house-1",
        lifecycleState: "active",
        captureLineageId: "unrelated-lineage",
        mergedFrom: [{ merchant: "legacy leaf", amount: 1_000 }],
        mergeLeafIds: ["unrelated-leaf"],
      },
    );

    const result = await persistence.cancel(
      cancellationFor(command, "canonical-precedence"),
    );

    expect(result).toEqual({
      kind: "cancelled",
      transactionIds: [created.transactionId],
    });
  });

  it("삭제된 과거 병합은 이후 일반 삭제된 leaf를 복원하지 않는다", async () => {
    const memory = new InMemoryFirestore();
    const persistence = subject(memory);
    const commandA = approval("A", 10_000);
    const commandB = approval("B", 20_000);
    const recordedA = await persistence.recordApproval(commandA);
    const recordedB = await persistence.recordApproval(commandB);
    if (recordedA.kind !== "recorded" || recordedB.kind !== "recorded") {
      throw new Error("APPROVAL_REQUIRED");
    }
    for (const path of [
      `households/house-1/ledgerTransactions/${recordedA.transactionId}`,
      `expenses/${recordedA.transactionId}`,
    ]) {
      const stored = memory.document(path);
      if (stored === undefined) throw new Error("TRANSACTION_REQUIRED");
      memory.seed(path, {
        ...stored,
        lifecycleState: "active",
        aggregateVersion: 3,
      });
    }
    for (const path of [
      `households/house-1/ledgerTransactions/${recordedB.transactionId}`,
      `expenses/${recordedB.transactionId}`,
    ]) {
      const stored = memory.document(path);
      if (stored === undefined) throw new Error("TRANSACTION_REQUIRED");
      memory.seed(path, {
        ...stored,
        lifecycleState: "deleted",
        aggregateVersion: 4,
      });
    }
    const mergedId = "deleted-merge-AB";
    const mergedSource = memory.document(
      `households/house-1/ledgerTransactions/${recordedA.transactionId}`,
    );
    if (mergedSource === undefined) throw new Error("TRANSACTION_REQUIRED");
    memory.seed(`households/house-1/ledgerTransactions/${mergedId}`, {
      ...mergedSource,
      lifecycleState: "deleted",
      aggregateVersion: 2,
      mergeLeafIds: [recordedA.transactionId, recordedB.transactionId],
    });

    const result = await persistence.cancel(
      cancellationFor(commandA, "after-unmerge-manual-delete"),
    );

    expect(result).toEqual({
      kind: "cancelled",
      transactionIds: [recordedA.transactionId, mergedId].sort((left, right) =>
        left.localeCompare(right, "en"),
      ),
    });
    expect(
      memory.document(
        `households/house-1/ledgerTransactions/${recordedB.transactionId}`,
      ),
    ).toMatchObject({ lifecycleState: "deleted", aggregateVersion: 4 });
    expect(memory.document(`expenses/${recordedB.transactionId}`)).toMatchObject({
      lifecycleState: "deleted",
      aggregateVersion: 4,
    });
  });
});

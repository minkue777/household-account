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

  it("authoritative 활성 병합의 복원 ID가 없으면 취소 전체를 막는다", async () => {
    const memory = new InMemoryFirestore();
    const persistence = subject(memory);
    const command = approval();
    const created = await persistence.recordApproval(command);
    if (created.kind !== "recorded") throw new Error("APPROVAL_REQUIRED");
    memory.seed("households/house-1/ledgerTransactions/incomplete-merge", {
      householdId: "house-1",
      lifecycleState: "active",
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

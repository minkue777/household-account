import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { FirebaseCaptureLedgerPersistence } from "../../../src/adapters/firebase/payment-capture/firebaseCaptureLedgerPersistence";
import type {
  CaptureApprovalPersistenceCommand,
  CaptureCancellationPersistenceCommand,
} from "../../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureLedgerPersistencePort";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

function approval(
  overrides: Partial<CaptureApprovalPersistenceCommand> = {},
): CaptureApprovalPersistenceCommand {
  return {
    householdId: "house-1",
    downstreamKey: "approval-1",
    branch: {
      observationId: "observation-approval-1",
      originChannel: "android-notification",
      creatorMemberId: "member-1",
      sourceType: "kb-card",
      parser: { parserId: "kb-card-parser", parserVersion: "2.0.0" },
      rawPayloadHash:
        "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      occurredAt: "2026-07-21T10:05:00+09:00",
      accountingDate: "2026-07-21",
      amountInWon: 12_000,
      originalMerchant: "가맹점 A",
      merchant: "가맹점 A",
      categoryId: "etc",
      memo: "",
      cardEvidence: { companyLabel: "국민", maskedToken: "1234" },
      canonicalCardId: "card-1",
    },
    ...overrides,
  };
}

function cancellation(): CaptureCancellationPersistenceCommand {
  return {
    householdId: "house-1",
    downstreamKey: "cancellation-1",
    branch: {
      observationId: "observation-cancellation-1",
      creatorMemberId: "member-1",
      sourceType: "kb-card",
      parser: { parserId: "kb-card-parser", parserVersion: "2.0.0" },
      rawPayloadHash:
        "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      observedAt: "2026-07-22T09:00:00+09:00",
      cancellationDate: "2026-07-22",
      amountInWon: 12_000,
      merchant: "가맹점 A",
      cardEvidence: { companyLabel: "국민", maskedToken: "1234" },
      canonicalCardId: "card-1",
    },
  };
}

describe("Firebase Capture → Ledger transaction adapter", () => {
  it("승인·dedup claim·immutable evidence·canonical/legacy·Outbox·receipt를 한 번만 commit한다", async () => {
    const memory = new InMemoryFirestore();
    const persistence = new FirebaseCaptureLedgerPersistence(
      memory as unknown as firestore.Firestore,
    );

    const first = await persistence.recordApproval(approval());
    const replay = await persistence.recordApproval(approval());

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      kind: "recorded",
      editable: true,
      aggregateVersion: 1,
    });
    if (first.kind !== "recorded") return;
    expect(
      memory.document(
        `households/house-1/ledgerTransactions/${first.transactionId}`,
      ),
    ).toMatchObject({
      householdId: "house-1",
      creatorMemberId: "member-1",
      createdBy: "member-1",
      captureLineageId: first.captureLineageId,
      suppressAutomaticNotification: true,
      notificationPolicy: "android-quick-edit-only",
      cardDisplay: "국민(1234)",
      aggregateVersion: 1,
    });
    expect(memory.document(`expenses/${first.transactionId}`)).toMatchObject({
      householdId: "house-1",
      creatorMemberId: "member-1",
      cardDisplay: "국민(1234)",
      cardLastFour: "국민(1234)",
      schemaVersion: 1,
    });
    expect(memory.paths("households/house-1/captureRecords/")).toHaveLength(1);
    expect(memory.paths("households/house-1/ledgerDedupKeys/")).toHaveLength(1);
    expect(memory.paths("outboxEvents/")).toHaveLength(1);
    expect(
      memory.paths("commandReceipts/payment-capture-ledger/receipts/"),
    ).toHaveLength(1);
  });

  it("같은 승인 fingerprint의 다른 branch key는 Duplicate이고 같은 key의 다른 payload는 mismatch다", async () => {
    const memory = new InMemoryFirestore();
    const persistence = new FirebaseCaptureLedgerPersistence(
      memory as unknown as firestore.Firestore,
    );
    const created = await persistence.recordApproval(approval());
    if (created.kind !== "recorded") throw new Error("승인 생성이 필요합니다.");

    const duplicate = await persistence.recordApproval(
      approval({ downstreamKey: "approval-2" }),
    );
    expect(duplicate).toEqual({
      kind: "duplicate",
      existingTransactionId: created.transactionId,
      editable: true,
      followUp: { kind: "notRequested" },
    });

    const mismatch = await persistence.recordApproval({
      ...approval(),
      branch: { ...approval().branch, amountInWon: 12_001 },
    });
    expect(mismatch).toEqual({
      kind: "rejected",
      code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
    });
    expect(memory.paths("households/house-1/ledgerTransactions/")).toHaveLength(1);
    expect(memory.paths("outboxEvents/")).toHaveLength(1);
  });

  it("30일 내 유일 승인 취소는 원본·파생을 모두 논리 삭제하고 claim을 tombstone으로 전환한다", async () => {
    const memory = new InMemoryFirestore();
    const persistence = new FirebaseCaptureLedgerPersistence(
      memory as unknown as firestore.Firestore,
    );
    const created = await persistence.recordApproval(approval());
    if (created.kind !== "recorded") throw new Error("승인 생성이 필요합니다.");
    const derived = {
      householdId: "house-1",
      transactionType: "expense",
      lifecycleState: "active",
      merchant: "분할 지출",
      amountInWon: 6_000,
      categoryId: "etc",
      aggregateVersion: 2,
      derivedFromTransactionId: created.transactionId,
      captureLineageId: created.captureLineageId,
    };
    memory.seed("households/house-1/ledgerTransactions/derived-1", derived);
    memory.seed("expenses/derived-1", derived);

    const result = await persistence.cancel(cancellation());
    const replay = await persistence.cancel(cancellation());

    expect(result).toEqual(replay);
    expect(result).toEqual({
      kind: "cancelled",
      transactionIds: [created.transactionId, "derived-1"].sort(),
    });
    expect(
      memory.document(
        `households/house-1/ledgerTransactions/${created.transactionId}`,
      ),
    ).toMatchObject({ lifecycleState: "deleted", aggregateVersion: 2 });
    expect(
      memory.document("households/house-1/ledgerTransactions/derived-1"),
    ).toMatchObject({ lifecycleState: "deleted", aggregateVersion: 3 });
    const claimPath = memory.paths("households/house-1/ledgerDedupKeys/")[0];
    expect(memory.document(claimPath)).toMatchObject({
      state: "cancelled",
      captureLineageId: created.captureLineageId,
      cancellationReceiptId: expect.any(String),
    });
    expect(memory.paths("outboxEvents/")).toHaveLength(3);
  });

  it("원거래가 없는 취소는 NotFound receipt만 남기고 dedup tombstone을 만들지 않는다", async () => {
    const memory = new InMemoryFirestore();
    const persistence = new FirebaseCaptureLedgerPersistence(
      memory as unknown as firestore.Firestore,
    );

    expect(await persistence.cancel(cancellation())).toEqual({
      kind: "notFound",
      resource: "cancellationTarget",
    });
    expect(memory.paths("households/house-1/ledgerDedupKeys/")).toEqual([]);
    expect(memory.paths("households/house-1/captureRecords/")).toEqual([]);
    expect(
      memory.paths("commandReceipts/payment-capture-ledger/receipts/"),
    ).toHaveLength(1);
  });
});

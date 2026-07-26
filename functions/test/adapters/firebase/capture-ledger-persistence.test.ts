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

function lineageApproval(
  label: "A" | "B" | "C",
  amountInWon: number,
  minute: string,
): CaptureApprovalPersistenceCommand {
  const base = approval();
  return {
    ...base,
    downstreamKey: `approval-${label}`,
    branch: {
      ...base.branch,
      observationId: `observation-approval-${label}`,
      occurredAt: `2026-07-21T10:${minute}:00+09:00`,
      amountInWon,
      originalMerchant: `merchant-${label}`,
      merchant: `merchant-${label}`,
      categoryId: `category-${label}`,
      memo: `memo-${label}`,
      canonicalCardId: `card-${label}`,
    },
  };
}

function lineageCancellation(
  command: CaptureApprovalPersistenceCommand,
  label: string,
): CaptureCancellationPersistenceCommand {
  const base = cancellation();
  return {
    ...base,
    downstreamKey: `cancellation-${label}`,
    branch: {
      ...base.branch,
      observationId: `observation-cancellation-${label}`,
      amountInWon: command.branch.amountInWon,
      merchant: command.branch.merchant,
      cardEvidence: command.branch.cardEvidence,
      canonicalCardId: command.branch.canonicalCardId,
    },
  };
}

async function mergedCaptureFixture() {
  const memory = new InMemoryFirestore();
  const persistence = new FirebaseCaptureLedgerPersistence(
    memory as unknown as firestore.Firestore,
  );
  const commands = {
    A: lineageApproval("A", 10_000, "01"),
    B: lineageApproval("B", 20_000, "02"),
    C: lineageApproval("C", 30_000, "03"),
  };
  const recordedA = await persistence.recordApproval(commands.A);
  const recordedB = await persistence.recordApproval(commands.B);
  const recordedC = await persistence.recordApproval(commands.C);
  if (
    recordedA.kind !== "recorded" ||
    recordedB.kind !== "recorded" ||
    recordedC.kind !== "recorded"
  ) {
    throw new Error("CAPTURE_FIXTURE_RECORDING_FAILED");
  }
  const records = { A: recordedA, B: recordedB, C: recordedC };
  const originals = new Map<string, Record<string, unknown>>();
  for (const record of Object.values(records)) {
    const path = `households/house-1/ledgerTransactions/${record.transactionId}`;
    const stored = memory.document(path);
    if (stored === undefined) throw new Error("CAPTURE_FIXTURE_LEAF_MISSING");
    originals.set(record.transactionId, stored);
    memory.seed(path, {
      ...stored,
      lifecycleState: "superseded",
      aggregateVersion: 2,
    });
    memory.remove(`expenses/${record.transactionId}`);
  }

  const mergedABId = "merged-AB";
  const mergedABCId = "merged-ABC";
  const target = originals.get(recordedA.transactionId);
  if (target === undefined) throw new Error("CAPTURE_FIXTURE_TARGET_MISSING");
  const mergedAB = {
    ...target,
    lifecycleState: "superseded",
    amountInWon: 30_000,
    amount: 30_000,
    aggregateVersion: 2,
    captureLineageId: recordedA.captureLineageId,
    mergeLeafIds: [recordedA.transactionId, recordedB.transactionId],
  };
  const mergedABC = {
    ...target,
    lifecycleState: "active",
    amountInWon: 60_000,
    amount: 60_000,
    aggregateVersion: 1,
    captureLineageId: recordedA.captureLineageId,
    mergeLeafIds: [
      recordedA.transactionId,
      recordedB.transactionId,
      recordedC.transactionId,
    ],
    intermediateMergeHistoryIds: [mergedABId],
  };
  memory.seed(
    `households/house-1/ledgerTransactions/${mergedABId}`,
    mergedAB,
  );
  memory.seed(
    `households/house-1/ledgerTransactions/${mergedABCId}`,
    mergedABC,
  );
  memory.seed(`expenses/${mergedABCId}`, {
    ...mergedABC,
    cardLastFour: target.cardDisplay,
    schemaVersion: 1,
  });

  return {
    memory,
    persistence,
    commands,
    records,
    originals,
    mergedABId,
    mergedABCId,
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
      quickEditSnapshot: {
        amountInWon: 12_000,
        accountingDate: "2026-07-21",
        localTime: "10:05",
        categoryId: "etc",
        memo: "",
        aggregateVersion: 1,
      },
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

  it("원 알림의 마스킹 증거는 보존하고 거래 표시에는 확정된 등록 카드 네 자리를 사용한다", async () => {
    const memory = new InMemoryFirestore();
    const persistence = new FirebaseCaptureLedgerPersistence(
      memory as unknown as firestore.Firestore,
    );
    const command = approval({
      downstreamKey: "approval-masked-card",
      branch: {
        ...approval().branch,
        cardEvidence: { companyLabel: "농협", maskedToken: "2*4*" },
        resolvedCardEvidence: {
          companyLabel: "농협",
          lastFour: "2546",
        },
        canonicalCardId: "nh-card-1",
      },
    });

    const result = await persistence.recordApproval(command);
    if (result.kind !== "recorded") throw new Error("승인 생성이 필요합니다.");

    expect(
      memory.document(
        `households/house-1/ledgerTransactions/${result.transactionId}`,
      ),
    ).toMatchObject({
      cardDisplay: "농협(2546)",
      canonicalCardId: "nh-card-1",
    });
    expect(
      memory.document("households/house-1/captureRecords/capture-record-" +
        result.captureLineageId.replace("capture-lineage-", "")),
    ).toMatchObject({
      cardEvidence: {
        companyLabel: "농협",
        lastFour: "24",
        maskedToken: "2*4*",
      },
      canonicalCardId: "nh-card-1",
    });
  });

  it("등록 카드 번호를 확정할 수 없으면 네 자리 마스킹 모양을 줄이지 않고 표시한다", async () => {
    const memory = new InMemoryFirestore();
    const persistence = new FirebaseCaptureLedgerPersistence(
      memory as unknown as firestore.Firestore,
    );

    const result = await persistence.recordApproval(
      approval({
        downstreamKey: "approval-unresolved-mask",
        branch: {
          ...approval().branch,
          cardEvidence: { companyLabel: "농협", maskedToken: "2*6*" },
          canonicalCardId: undefined,
        },
      }),
    );
    if (result.kind !== "recorded") throw new Error("승인 생성이 필요합니다.");

    expect(memory.document(`expenses/${result.transactionId}`)).toMatchObject({
      cardDisplay: "농협(2*6*)",
      cardLastFour: "농협(2*6*)",
    });
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
    ).toBeUndefined();
    expect(
      memory.document("households/house-1/ledgerTransactions/derived-1"),
    ).toBeUndefined();
    expect(memory.document(`expenses/${created.transactionId}`)).toBeUndefined();
    expect(memory.document("expenses/derived-1")).toBeUndefined();
    const claimPath = memory.paths("households/house-1/ledgerDedupKeys/")[0];
    expect(memory.document(claimPath)).toMatchObject({
      state: "cancelled",
      captureLineageId: created.captureLineageId,
      cancellationReceiptId: expect.any(String),
    });
    expect(memory.paths("outboxEvents/")).toHaveLength(3);
  });

  it.each([
    {
      label: "A" as const,
      restoredLabels: ["B", "C"] as const,
      deletesMergedAB: true,
    },
    {
      label: "B" as const,
      restoredLabels: ["A", "C"] as const,
      deletesMergedAB: true,
    },
    {
      label: "C" as const,
      restoredLabels: ["A", "B"] as const,
      deletesMergedAB: false,
    },
  ])(
    "평탄 병합에서 $label lineage 취소는 영향 병합만 삭제하고 비취소 leaf의 전체 projection을 복원한다",
    async ({ label, restoredLabels, deletesMergedAB }) => {
      const fixture = await mergedCaptureFixture();
      const cancelled = fixture.records[label];
      const expectedDeleted = [cancelled.transactionId, fixture.mergedABCId];
      if (deletesMergedAB) expectedDeleted.push(fixture.mergedABId);

      const result = await fixture.persistence.cancel(
        lineageCancellation(fixture.commands[label], label),
      );

      expect(result).toEqual({
        kind: "cancelled",
        transactionIds: expectedDeleted.sort((left, right) =>
          left.localeCompare(right, "en"),
        ),
      });
      for (const transactionId of expectedDeleted) {
        expect(
          fixture.memory.document(
            `households/house-1/ledgerTransactions/${transactionId}`,
          ),
        ).toBeUndefined();
        expect(
          fixture.memory.document(`expenses/${transactionId}`),
        ).toBeUndefined();
      }

      for (const restoredLabel of restoredLabels) {
        const record = fixture.records[restoredLabel];
        const original = fixture.originals.get(record.transactionId);
        if (original === undefined) throw new Error("RESTORED_FIXTURE_MISSING");
        const expectedProjection = {
          householdId: "house-1",
          transactionType: "expense",
          lifecycleState: "active",
          merchant: original.merchant,
          amountInWon: original.amountInWon,
          amount: original.amount,
          categoryId: original.categoryId,
          category: original.category,
          memo: original.memo,
          accountingDate: original.accountingDate,
          date: original.date,
          localTime: original.localTime,
          time: original.time,
          cardType: original.cardType,
          cardDisplay: original.cardDisplay,
          captureLineageId: record.captureLineageId,
          source: original.source,
          originChannel: original.originChannel,
          creatorMemberId: original.creatorMemberId,
          aggregateVersion: 3,
        };
        expect(
          fixture.memory.document(
            `households/house-1/ledgerTransactions/${record.transactionId}`,
          ),
        ).toMatchObject({ ...expectedProjection, schemaVersion: 2 });
        expect(
          fixture.memory.document(`expenses/${record.transactionId}`),
        ).toMatchObject({
          ...expectedProjection,
          cardLastFour: original.cardDisplay,
          schemaVersion: 1,
        });
      }

      if (!deletesMergedAB) {
        expect(
          fixture.memory.document(
            `households/house-1/ledgerTransactions/${fixture.mergedABId}`,
          ),
        ).toMatchObject({ lifecycleState: "superseded", aggregateVersion: 2 });
        expect(
          fixture.memory.document(`expenses/${fixture.mergedABId}`),
        ).toBeUndefined();
      }
    },
  );

  it("영향 병합의 비취소 leaf snapshot이 없으면 취소 전체를 typed 무변경으로 거절한다", async () => {
    const fixture = await mergedCaptureFixture();
    const missing = fixture.records.B.transactionId;
    fixture.memory.remove(
      `households/house-1/ledgerTransactions/${missing}`,
    );
    fixture.memory.remove(`expenses/${missing}`);
    const outboxCount = fixture.memory.paths("outboxEvents/").length;
    const receiptCount = fixture.memory.paths(
      "commandReceipts/payment-capture-ledger/receipts/",
    ).length;

    const result = await fixture.persistence.cancel(
      lineageCancellation(fixture.commands.A, "missing-leaf"),
    );

    expect(result).toEqual({
      kind: "rejected",
      code: "RESTORATION_SNAPSHOT_INCOMPLETE",
    });
    expect(
      fixture.memory.document(
        `households/house-1/ledgerTransactions/${fixture.records.A.transactionId}`,
      ),
    ).toMatchObject({ lifecycleState: "superseded", aggregateVersion: 2 });
    expect(
      fixture.memory.document(
        `households/house-1/ledgerTransactions/${fixture.mergedABId}`,
      ),
    ).toMatchObject({ lifecycleState: "superseded", aggregateVersion: 2 });
    expect(
      fixture.memory.document(
        `households/house-1/ledgerTransactions/${fixture.mergedABCId}`,
      ),
    ).toMatchObject({ lifecycleState: "active", aggregateVersion: 1 });
    expect(fixture.memory.paths("outboxEvents/")).toHaveLength(outboxCount);
    expect(
      fixture.memory.paths("commandReceipts/payment-capture-ledger/receipts/"),
    ).toHaveLength(receiptCount);
    const targetClaim = fixture.memory
      .paths("households/house-1/ledgerDedupKeys/")
      .map((path) => fixture.memory.document(path))
      .find(
        (claim) =>
          claim?.captureLineageId === fixture.records.A.captureLineageId,
      );
    expect(targetClaim).toMatchObject({ state: "active" });
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

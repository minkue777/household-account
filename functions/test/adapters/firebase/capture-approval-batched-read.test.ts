import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { FirebaseCaptureLedgerPersistence } from "../../../src/adapters/firebase/payment-capture/firebaseCaptureLedgerPersistence";
import type { CaptureApprovalPersistenceCommand } from "../../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureLedgerPersistencePort";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

function approval(originChannel: "android-notification" | "ios-shortcut"): CaptureApprovalPersistenceCommand {
  return {
    householdId: "house-1", downstreamKey: "observation-1",
    branch: {
      observationId: "observation-1", originChannel, creatorMemberId: "member-1",
      sourceType: "kb-card", parser: { parserId: "kb-card-parser", parserVersion: "2.0.0" },
      rawPayloadHash: `sha256:${"1".repeat(64)}`, occurredAt: "2026-09-07T10:00:00+09:00",
      accountingDate: "2026-09-07", amountInWon: 12000,
      originalMerchant: "Synthetic merchant", merchant: "Synthetic merchant", categoryId: "etc", memo: "",
      cardEvidence: { companyLabel: "국민", maskedToken: "1234" }, canonicalCardId: "card-1",
    },
  };
}

function subject() {
  const memory = new InMemoryFirestore();
  const runTransaction = memory.runTransaction.bind(memory);
  const batches: string[][] = [];
  memory.runTransaction = async operation => runTransaction(async transaction => {
    const getAll = transaction.getAll.bind(transaction);
    transaction.getAll = async (...references) => {
      batches.push(references.map(reference => reference.path));
      return getAll(...references);
    };
    return operation(transaction);
  });
  return { memory, batches, persistence: new FirebaseCaptureLedgerPersistence(memory as unknown as Firestore) };
}

describe("capture approval atomic batch reads", () => {
  it.each(["android-notification", "ios-shortcut"] as const)(
    "%s reads receipt and dedup once per transaction and preserves replay, mismatch and duplicate effects",
    async originChannel => {
      const { memory, batches, persistence } = subject();
      const command = approval(originChannel);
      const first = await persistence.recordApproval(command);
      expect(first).toMatchObject({ kind: "recorded", editable: true, aggregateVersion: 1 });
      expect(batches).toEqual([[
        expect.stringContaining("commandReceipts/payment-capture-ledger/receipts/"),
        expect.stringContaining("/ledgerDedupKeys/"),
      ]]);
      expect(memory.transactionReads()).toHaveLength(2);
      const firstPaths = memory.paths("");
      expect(firstPaths).toHaveLength(6);

      await expect(persistence.recordApproval(command)).resolves.toEqual(first);
      await expect(persistence.recordApproval({
        ...command, branch: { ...command.branch, rawPayloadHash: `sha256:${"2".repeat(64)}` },
      })).resolves.toEqual({ kind: "rejected", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
      expect(memory.paths("")).toEqual(firstPaths);

      const duplicate = await persistence.recordApproval({ ...command, downstreamKey: "another-observation" });
      expect(duplicate).toMatchObject({ kind: "duplicate", editable: true,
        followUp: { kind: originChannel === "ios-shortcut" ? "outboxQueued" : "notRequested" } });
      expect(memory.paths("households/house-1/ledgerTransactions/")).toHaveLength(1);
      expect(memory.paths("expenses/")).toHaveLength(1);
      expect(memory.paths("households/house-1/captureRecords/")).toHaveLength(1);
      expect(memory.paths("households/house-1/ledgerDedupKeys/")).toHaveLength(1);
      expect(memory.paths("outboxEvents/")).toHaveLength(originChannel === "ios-shortcut" ? 2 : 1);
      expect(batches).toHaveLength(4);
      expect(batches.every(paths => paths.length === 2)).toBe(true);
    },
  );

  it("replays the original result before a later cancelled dedup state and keeps new duplicate noneditable", async () => {
    const { memory, persistence } = subject();
    const command = approval("android-notification");
    const first = await persistence.recordApproval(command);
    const dedupPath = memory.paths("households/house-1/ledgerDedupKeys/")[0];
    memory.seed(dedupPath, { ...memory.document(dedupPath), state: "cancelled" });

    await expect(persistence.recordApproval(command)).resolves.toEqual(first);
    await expect(persistence.recordApproval({ ...command, downstreamKey: "after-cancellation" }))
      .resolves.toMatchObject({ kind: "duplicate", editable: false, followUp: { kind: "notRequested" } });
    expect(memory.paths("households/house-1/ledgerTransactions/")).toHaveLength(1);
    expect(memory.paths("outboxEvents/")).toHaveLength(1);
  });

  it.each(["PERMISSION_DENIED", "UNAVAILABLE"])("a %s batch failure does not create any state", async code => {
    const memory = new InMemoryFirestore();
    const runTransaction = memory.runTransaction.bind(memory);
    memory.runTransaction = async operation => runTransaction(async transaction => {
      transaction.getAll = async () => { throw new Error(code); };
      return operation(transaction);
    });
    const persistence = new FirebaseCaptureLedgerPersistence(memory as unknown as Firestore);
    await expect(persistence.recordApproval(approval("android-notification")))
      .resolves.toEqual({ kind: "retryable-failure", code: "LEDGER_UNAVAILABLE" });
    expect(memory.paths("")).toEqual([]);
  });

  it("an uncommitted attempt leaves no partial state and the same command can be retried", async () => {
    const memory = new InMemoryFirestore();
    const runTransaction = memory.runTransaction.bind(memory);
    memory.runTransaction = async operation => runTransaction(async transaction => {
      await operation(transaction);
      throw new Error("COMMIT_UNAVAILABLE");
    });
    const persistence = new FirebaseCaptureLedgerPersistence(memory as unknown as Firestore);
    const command = approval("android-notification");
    await expect(persistence.recordApproval(command)).resolves.toEqual({ kind: "retryable-failure", code: "LEDGER_UNAVAILABLE" });
    expect(memory.paths("")).toEqual([]);

    memory.runTransaction = runTransaction;
    await expect(persistence.recordApproval(command)).resolves.toMatchObject({ kind: "recorded" });
    expect(memory.paths("")).toHaveLength(6);
  });

  it("a retried transaction reads the new dedup snapshot before committing any previously staged approval", async () => {
    const { memory, batches, persistence } = subject();
    const trackedRunTransaction = memory.runTransaction.bind(memory);
    memory.runTransaction = async operation => {
      await expect(trackedRunTransaction(async transaction => {
        await operation(transaction);
        throw new Error("RETRY_FIRST_ATTEMPT");
      })).rejects.toThrow("RETRY_FIRST_ATTEMPT");
      expect(memory.paths("")).toEqual([]);
      memory.seed(batches[0][1], { transactionId: "other-committed-transaction", state: "cancelled" });
      return trackedRunTransaction(operation);
    };

    await expect(persistence.recordApproval(approval("android-notification"))).resolves.toMatchObject({
      kind: "duplicate", existingTransactionId: "other-committed-transaction", editable: false,
    });
    expect(batches).toHaveLength(2);
    expect(memory.paths("households/house-1/ledgerTransactions/")).toEqual([]);
    expect(memory.paths("expenses/")).toEqual([]);
    expect(memory.paths("outboxEvents/")).toEqual([]);
  });
});

import type { Firestore } from "firebase-admin/firestore";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FirebaseItemSplitStore } from "../../../src/adapters/firebase/ledger/firebaseItemSplitStore";
import { FirebaseLedgerCommandRepository } from "../../../src/adapters/firebase/ledger/firebaseLedgerCommandRepository";
import { createLedgerHouseholdCommandHandlers } from "../../../src/bootstrap/commands/ledgerHouseholdCommandHandlers";
import { createHouseholdCommandRouter } from "../../../src/bootstrap/commands/householdCommandRouter";
import type { HouseholdCommandReceiptPort, ResolveHouseholdActorResult } from "../../../src/bootstrap/commands/householdCommandPorts";
import type { HouseholdCommandExecutionContext } from "../../../src/bootstrap/commands/householdCommand";
import { createItemSplitRestorationCommands } from "../../../src/contexts/household-finance/ledger/application/commands/itemSplitRestorationService";
import type { LedgerTransactionView } from "../../../src/contexts/household-finance/ledger/domain/model/ledgerTransaction";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

type MemoryTransaction = Parameters<Parameters<InMemoryFirestore["runTransaction"]>[0]>[0];

class ObservedFirestore extends InMemoryFirestore {
  readonly readBatches: string[][] = [];
  beforeTransaction?: () => void;
  categoryReads = 0;
  categoryReadGate?: Promise<void>;
  categoryReadFailure?: Error;

  override collection(path: string) {
    const reference = super.collection(path);
    if (path === "categories") {
      const where = reference.where.bind(reference);
      reference.where = (...conditions) => {
        const query = where(...conditions);
        const get = query.get.bind(query);
        query.get = async () => {
          this.categoryReads += 1;
          await this.categoryReadGate;
          if (this.categoryReadFailure) throw this.categoryReadFailure;
          return get();
        };
        return query;
      };
    }
    return reference;
  }

  override async runTransaction<T>(operation: (transaction: MemoryTransaction) => Promise<T>): Promise<T> {
    this.beforeTransaction?.();
    return super.runTransaction(async (transaction) => {
      const getAll = transaction.getAll.bind(transaction);
      transaction.getAll = async (...references) => {
        this.readBatches.push(references.map((reference) => reference.path));
        return getAll(...references);
      };
      return operation(transaction);
    });
  }
}

const householdId = "ledger-read-efficiency";
const now = "2026-09-07T12:00:00.000Z";
const canonical = (id: string) => `households/${householdId}/ledgerTransactions/${id}`;
const source: LedgerTransactionView = {
  transactionId: "source", householdId, transactionType: "expense",
  lifecycleState: "active", aggregateVersion: 2, merchant: "가맹점",
  amountInWon: 10000, accountingDate: "2026-09-07", categoryId: "etc", memo: "원본",
  cardType: "captured", cardDisplay: "현대1234", localTime: "12:34",
  source: "notification", creatorMemberId: "member",
};

function fixture() {
  const database = new ObservedFirestore();
  database.seed(canonical("source"), {
    ...source, originChannel: "android", cardEvidence: "현대카드|1234", captureLineageId: "capture-original",
  });
  database.seed("categories/etc", { householdId, key: "etc", isActive: true });
  return database;
}

function execute(database: InMemoryFirestore, command: string, payload: Record<string, unknown>, commandId = command) {
  const context: HouseholdCommandExecutionContext = {
    principalUid: "uid", requestedAt: now,
    actor: { principalUid: "uid", householdId, actingMemberId: "member", capabilities: ["household.read", "household.write"] },
    envelope: { contractVersion: "household-command.v1", command, commandId, idempotencyKey: commandId, householdId, payload },
  };
  return createLedgerHouseholdCommandHandlers(database as unknown as Firestore).get(command)!.execute(context);
}

async function split(database: InMemoryFirestore) {
  const result = await execute(database, "ledger.split-transaction.v1", {
    transactionId: "source", expectedVersion: 2,
    items: [{ merchant: "A", amountInWon: 4000, categoryId: "etc" }, { merchant: "B", amountInWon: 6000, categoryId: "etc" }],
  }) as { transactionIds: string[] };
  return Object.fromEntries(result.transactionIds.map((id) => [id, 1]));
}

afterEach(() => vi.restoreAllMocks());

describe("Ledger mutation bounded reads", () => {
  it.each(["ledger.update-transaction.v1", "ledger.delete-transaction.v1"])(
    "routes matching Android keys for %s through the atomic domain receipt and rejects changed payloads", async command => {
      const database = fixture();
      const receipts = {
        claim: vi.fn<HouseholdCommandReceiptPort["claim"]>(),
        complete: vi.fn<HouseholdCommandReceiptPort["complete"]>(),
        abandon: vi.fn<HouseholdCommandReceiptPort["abandon"]>(),
      };
      const router = createHouseholdCommandRouter({
        handlers: createLedgerHouseholdCommandHandlers(database as unknown as Firestore),
        receipts, hashes: { hash: value => value },
        memberships: { resolveActor: async () => ({ kind: "active", actor: {
          principalUid: "uid", householdId, actingMemberId: "member", capabilities: ["household.read", "household.write"],
        } }) },
      });
      const request = {
        contractVersion: "household-command.v1", command, householdId,
        commandId: "android:quick-edit-1", idempotencyKey: "android:quick-edit-1",
        payload: { transactionId: "source", expectedVersion: 2,
          ...(command === "ledger.update-transaction.v1" ? { patch: { categoryId: "etc" } } : {}),
        },
      };
      const call = (envelope = request) => router.execute({ principalUid: "uid", request: envelope, requestedAt: now });
      const first = await call();
      expect(first).toMatchObject({ kind: "success", commandId: request.commandId });
      await expect(call()).resolves.toEqual(first);
      await expect(call({ ...request, payload: { ...request.payload, expectedVersion: 3 } }))
        .resolves.toMatchObject({ kind: "error", code: "COMMAND_FAILED", details: { domainCode: "IDEMPOTENCY_PAYLOAD_MISMATCH" } });
      expect(receipts.claim).not.toHaveBeenCalled();
      expect(receipts.complete).not.toHaveBeenCalled();
      expect(receipts.abandon).not.toHaveBeenCalled();
      expect(database.paths("outboxEvents/")).toHaveLength(1);
      expect(database.paths("commandReceipts/")).toHaveLength(1);
      expect(database.document(canonical("source"))).toMatchObject({ aggregateVersion: 3 });
    },
  );

  it("does not start category or transaction preflight until membership is authorized", async () => {
    const database = fixture();
    let resolveMembership!: (result: ResolveHouseholdActorResult) => void;
    const membership = new Promise<ResolveHouseholdActorResult>(resolve => { resolveMembership = resolve; });
    const findTransaction = vi.spyOn(FirebaseLedgerCommandRepository.prototype, "findTransaction");
    const findReceipt = vi.spyOn(FirebaseLedgerCommandRepository.prototype, "findReceipt");
    const router = createHouseholdCommandRouter({
      handlers: createLedgerHouseholdCommandHandlers(database as unknown as Firestore),
      memberships: { resolveActor: () => membership }, hashes: { hash: value => value },
      receipts: { claim: vi.fn(), complete: vi.fn(), abandon: vi.fn() },
    });
    const pending = router.execute({ principalUid: "uid", requestedAt: now, request: {
      contractVersion: "household-command.v1", command: "ledger.update-transaction.v1", householdId,
      commandId: "android:unauthorized", idempotencyKey: "android:unauthorized",
      payload: { transactionId: "source", expectedVersion: 2, patch: { categoryId: "etc" } },
    } });
    await Promise.resolve();
    expect(database.categoryReads).toBe(0);
    expect(findReceipt).not.toHaveBeenCalled();
    expect(findTransaction).not.toHaveBeenCalled();
    resolveMembership({ kind: "forbidden" });
    await expect(pending).resolves.toMatchObject({ kind: "error", code: "HOUSEHOLD_FORBIDDEN" });
    expect(database.categoryReads).toBe(0);
    expect(findReceipt).not.toHaveBeenCalled();
    expect(findTransaction).not.toHaveBeenCalled();
    expect(database.paths("outboxEvents/")).toEqual([]);
  });

  it("batches receipt and both transaction copies while preserving the receipt and outbox", async () => {
    const database = fixture();
    await execute(database, "ledger.update-transaction.v1", { transactionId: "source", expectedVersion: 2, patch: { memo: "수정" } });
    expect(database.readBatches).toHaveLength(1);
    expect(database.readBatches[0]).toEqual([
      expect.stringMatching(/^commandReceipts\/household-finance-ledger\/receipts\//),
      canonical("source"), "expenses/source",
    ]);
    for (const path of [canonical("source"), "expenses/source"]) {
      expect(database.document(path)).toMatchObject({ memo: "수정", aggregateVersion: 3 });
    }
    expect(database.paths("outboxEvents/")).toHaveLength(1);
    expect(database.paths("commandReceipts/")).toHaveLength(1);
    expect(database.categoryReads).toBe(0);
  });

  it.each(["ledger.update-transaction.v1", "ledger.change-transaction-category.v1"])(
    "%s starts receipt and transaction reads while its category query is pending", async command => {
      const database = fixture();
      let releaseCategory!: () => void;
      database.categoryReadGate = new Promise<void>(resolve => { releaseCategory = resolve; });
      const findReceipt = vi.spyOn(FirebaseLedgerCommandRepository.prototype, "findReceipt");
      const findTransaction = vi.spyOn(FirebaseLedgerCommandRepository.prototype, "findTransaction");
      const payload = {
        transactionId: "source", expectedVersion: 2,
        ...(command === "ledger.update-transaction.v1" ? { patch: { categoryId: "etc" } } : { categoryId: "etc" }),
      };
      const pending = execute(database, command, payload);
      await vi.waitFor(() => expect(database.categoryReads).toBe(1));
      expect(findReceipt).toHaveBeenCalledOnce();
      expect(findTransaction).toHaveBeenCalledOnce();
      expect(database.paths("outboxEvents/")).toEqual([]);
      expect(database.document(canonical("source"))).toMatchObject({ aggregateVersion: 2 });
      releaseCategory();
      await expect(pending).resolves.toMatchObject({ categoryId: "etc", aggregateVersion: 3 });
      expect(database.categoryReads).toBe(1);
    },
  );

  it("replays category updates and rejects payload mismatches even if the category source subsequently fails", async () => {
    const database = fixture();
    const payload = { transactionId: "source", expectedVersion: 2, patch: { categoryId: "etc" } };
    const result = await execute(database, "ledger.update-transaction.v1", payload);
    database.categoryReadFailure = new Error("category source unavailable");
    await expect(execute(database, "ledger.update-transaction.v1", payload)).resolves.toEqual(result);
    await expect(execute(database, "ledger.update-transaction.v1", { ...payload, patch: { categoryId: "other" } }))
      .rejects.toThrow("IDEMPOTENCY_PAYLOAD_MISMATCH");
    expect(database.document(canonical("source"))).toMatchObject({ categoryId: "etc", aggregateVersion: 3 });
    expect(database.paths("outboxEvents/")).toHaveLength(1);
    expect(database.paths("commandReceipts/")).toHaveLength(1);
  });

  it("rejects a concurrent version change discovered in the batched commit read", async () => {
    const database = fixture();
    database.beforeTransaction = () => database.seed(canonical("source"), { ...source, aggregateVersion: 3, memo: "다른 수정" });
    await expect(execute(database, "ledger.update-transaction.v1", {
      transactionId: "source", expectedVersion: 2, patch: { memo: "덮어쓰기" },
    })).rejects.toThrow("LEDGER_CONCURRENT_WRITE");
    expect(database.document(canonical("source"))).toMatchObject({ memo: "다른 수정", aggregateVersion: 3 });
    expect(database.paths("outboxEvents/")).toEqual([]);
    expect(database.paths("commandReceipts/")).toEqual([]);
  });

  it("keeps a committed receipt ahead of stale versions and rejects a changed payload hash", async () => {
    const database = fixture();
    const committed = { ...source, aggregateVersion: 3, memo: "수정" };
    const command = {
      commandId: "commit-replay", householdId, occurredAt: now, transaction: committed,
      event: { type: "TransactionChanged.v1", transactionId: "source" },
      result: { kind: "success" as const, value: committed },
    };
    const repository = new FirebaseLedgerCommandRepository(database as unknown as Firestore, householdId, "payload-a");
    await expect(repository.commit(command)).resolves.toEqual({ kind: "success" });
    database.seed(canonical("source"), { ...committed, aggregateVersion: 10, memo: "이후 수정" });
    await expect(repository.commit(command)).resolves.toEqual({ kind: "success", replayedResult: command.result });
    const mismatch = new FirebaseLedgerCommandRepository(database as unknown as Firestore, householdId, "payload-b");
    await expect(mismatch.commit(command)).resolves.toEqual({
      kind: "success", replayedResult: { kind: "validation-error", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" },
    });
    expect(database.document(canonical("source"))).toMatchObject({ aggregateVersion: 10, memo: "이후 수정" });
    expect(database.paths("outboxEvents/")).toHaveLength(1);
  });

  it("loads restoration once, fills only the omitted hidden source version and batches all commit targets", async () => {
    const database = fixture();
    const expectedVersions = await split(database);
    const load = vi.spyOn(FirebaseItemSplitStore.prototype, "load");
    database.readBatches.length = 0;
    await expect(execute(database, "ledger.restore-item-split.v1", { sourceId: "source", expectedVersions }))
      .resolves.toEqual({ transactionId: "source" });
    expect(load).toHaveBeenCalledExactlyOnceWith({ sourceId: "source", includeDerived: true });
    expect(database.readBatches).toHaveLength(1);
    expect(new Set(database.readBatches[0])).toEqual(new Set(
      ["source", ...Object.keys(expectedVersions)].flatMap((id) => [canonical(id), `expenses/${id}`]),
    ));
    expect(database.document(canonical("source"))).toMatchObject({
      lifecycleState: "active", aggregateVersion: 4, amountInWon: 10000,
      captureLineageId: "capture-original", cardEvidence: "현대카드|1234",
    });
    for (const id of Object.keys(expectedVersions)) {
      expect(database.document(canonical(id))).toBeUndefined();
      expect(database.document(`expenses/${id}`)).toBeUndefined();
    }
  });

  it("replays restoration before reading an original that no longer exists", async () => {
    const database = fixture();
    const expectedVersions = await split(database);
    const payload = { sourceId: "source", expectedVersions };
    await execute(database, "ledger.restore-item-split.v1", payload);
    database.remove(canonical("source"));
    database.remove("expenses/source");
    const before = database.paths();
    const load = vi.spyOn(FirebaseItemSplitStore.prototype, "load");
    await expect(execute(database, "ledger.restore-item-split.v1", payload)).resolves.toEqual({ transactionId: "source" });
    expect(load).not.toHaveBeenCalled();
    expect(database.paths()).toEqual(before);
  });

  it.each(["stale-source", "stale-derived", "missing-derived"] as const)(
    "does not replace client version checks for %s", async (kind) => {
      const database = fixture();
      const expectedVersions = await split(database);
      const child = Object.keys(expectedVersions)[0];
      if (kind === "stale-source") expectedVersions.source = 2;
      if (kind === "stale-derived") expectedVersions[child] = 2;
      if (kind === "missing-derived") delete expectedVersions[child];
      const before = database.paths().map((path) => [path, database.document(path)]);
      await expect(execute(database, "ledger.restore-item-split.v1", { sourceId: "source", expectedVersions }))
        .rejects.toThrow("VERSION_MISMATCH");
      expect(database.paths().map((path) => [path, database.document(path)])).toEqual(before);
    },
  );

  it("keeps the strict domain default and the handler's original missing-source rejection", async () => {
    const database = fixture();
    const expectedVersions = await split(database);
    const commands = createItemSplitRestorationCommands({
      store: new FirebaseItemSplitStore(database as unknown as Firestore, householdId, now),
    });
    await expect(commands.restore({
      actor: { householdId, memberId: "member" }, operationKey: "strict-restore", sourceId: "source", expectedVersions,
    })).resolves.toEqual({ kind: "Conflict", code: "VERSION_MISMATCH" });
    await expect(execute(database, "ledger.restore-item-split.v1", { sourceId: "absent", expectedVersions }))
      .rejects.toThrow("TRANSACTION_NOT_FOUND");
  });

  it("still rejects a derived transaction changed between the single load and atomic restore", async () => {
    const database = fixture();
    const expectedVersions = await split(database);
    const child = Object.keys(expectedVersions)[0];
    const writesBefore = database.paths("outboxEvents/");
    const receiptsBefore = database.paths("commandReceipts/");
    database.beforeTransaction = () => database.seed(canonical(child), {
      ...database.document(canonical(child)), aggregateVersion: 2, memo: "다른 수정",
    });
    await expect(execute(database, "ledger.restore-item-split.v1", { sourceId: "source", expectedVersions }))
      .rejects.toThrow("LEDGER_CONCURRENT_WRITE");
    expect(database.document(canonical("source"))).toMatchObject({ lifecycleState: "superseded", aggregateVersion: 3 });
    expect(database.document(canonical(child))).toMatchObject({ memo: "다른 수정", aggregateVersion: 2 });
    expect(database.paths("outboxEvents/")).toEqual(writesBefore);
    expect(database.paths("commandReceipts/")).toEqual(receiptsBefore);
  });
});

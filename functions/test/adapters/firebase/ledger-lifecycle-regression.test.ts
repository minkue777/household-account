import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { createLedgerHouseholdCommandHandlers } from "../../../src/bootstrap/commands/ledgerHouseholdCommandHandlers";
import type { HouseholdCommandExecutionContext } from "../../../src/bootstrap/commands/householdCommand";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

const householdId = "lifecycle-regression";
const now = "2026-09-06T10:00:00.000Z";
const canonical = (id: string) => `households/${householdId}/ledgerTransactions/${id}`;

function seed(database: InMemoryFirestore, lifecycleState = "active") {
  database.seed(canonical("captured"), {
    householdId, transactionType: "expense", lifecycleState, aggregateVersion: 2,
    merchant: "가맹점", amountInWon: 10000, accountingDate: "2026-09-06",
    categoryId: "etc", memo: "원본 메모", cardType: "captured", cardDisplay: "현대1234",
    cardEvidence: "현대카드|1234", captureLineageId: "capture-original",
    localTime: "12:34", source: "notification", originChannel: "android", creatorMemberId: "member",
  });
}

function execute(database: InMemoryFirestore, command: string, payload: Record<string, unknown>, commandId = command) {
  const context: HouseholdCommandExecutionContext = {
    principalUid: "uid", requestedAt: now,
    actor: { principalUid: "uid", householdId, actingMemberId: "member", capabilities: ["household.read", "household.write"] },
    envelope: { contractVersion: "household-command.v1", command, commandId, idempotencyKey: commandId, householdId, payload },
  };
  return createLedgerHouseholdCommandHandlers(database as unknown as Firestore).get(command)!.execute(context);
}

describe("Ledger command lifecycle regressions", () => {
  it("restores an item split through the registered production handler", async () => {
    const database = new InMemoryFirestore();
    seed(database);
    database.seed("categories/etc", { householdId, key: "etc", isActive: true });
    const split = await execute(database, "ledger.split-transaction.v1", { transactionId: "captured", expectedVersion: 2, items: [{ merchant: "A", amountInWon: 4000, categoryId: "etc" }, { merchant: "B", amountInWon: 6000, categoryId: "etc" }] }) as { transactionIds: string[] };
    const result = await execute(database, "ledger.restore-item-split.v1", { sourceId: "captured", expectedVersions: Object.fromEntries(split.transactionIds.map(id => [id, 1])) });
    expect(result).toEqual({ transactionId: "captured" });
    expect(database.document(canonical("captured"))).toMatchObject({ lifecycleState: "active", amountInWon: 10000, captureLineageId: "capture-original", aggregateVersion: 4 });
    for (const id of split.transactionIds) expect(database.document(canonical(id))).toBeUndefined();
  });

  it.each(["ledger.update-transaction.v1", "ledger.delete-transaction.v1", "ledger.request-notification.v1"])("rejects %s for a superseded original without resurrecting it", async (command) => {
    const database = new InMemoryFirestore();
    seed(database, "superseded");
    await expect(execute(database, command, { transactionId: "captured", expectedVersion: 2, patch: { memo: "수정" } })).rejects.toThrow();
    expect(database.document(canonical("captured"))).toMatchObject({ lifecycleState: "superseded", aggregateVersion: 2 });
    expect(database.paths().filter(path => path.startsWith("outboxEvents/"))).toEqual([]);
  });

  it("persists deletion time in canonical and legacy documents", async () => {
    const database = new InMemoryFirestore();
    seed(database);
    await execute(database, "ledger.delete-transaction.v1", { transactionId: "captured", expectedVersion: 2 });
    for (const path of [canonical("captured"), "expenses/captured"]) {
      expect(database.document(path)).toMatchObject({ lifecycleState: "deleted", deletedAt: now, aggregateVersion: 3 });
    }
  });

  it("preserves capture lineage, immutable card evidence and time on monthly children", async () => {
    const database = new InMemoryFirestore();
    seed(database);
    const result = await execute(database, "ledger.split-existing-transaction-monthly.v1", { transactionId: "captured", expectedVersion: 2, months: 3 }) as { transactionIds: string[] };
    expect(result.transactionIds).toHaveLength(3);
    for (const id of result.transactionIds) {
      for (const path of [canonical(id), `expenses/${id}`]) {
        expect(database.document(path)).toMatchObject({ captureLineageId: "capture-original", cardEvidence: "현대카드|1234", localTime: "12:34", source: "notification", originChannel: "android", memo: "원본 메모" });
      }
    }
  });
});

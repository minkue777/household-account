import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { createLedgerHouseholdCommandHandlers } from "../../src/bootstrap/commands/ledgerHouseholdCommandHandlers";
import type { HouseholdCommandExecutionContext } from "../../src/bootstrap/commands/householdCommand";

const receiptResult = {
  kind: "success",
  value: {
    transactionId: "transaction-1",
    householdId: "household-1",
    transactionType: "expense",
    merchant: "가맹점",
    memo: "",
    amountInWon: 10_000,
    categoryId: "etc",
    accountingDate: "2026-07-22",
    localTime: "12:00",
    cardDisplay: "수동",
    cardType: "manual",
    creatorMemberId: "member-1",
    lifecycleState: "active",
    aggregateVersion: 1,
  },
};

function subject() {
  let categoryReads = 0;
  const database = {
    collection(name: string) {
      if (name === "categories") {
        categoryReads += 1;
        return {
          where: () => ({
            get: async () => ({
              docs: [{ id: "category-etc", data: () => ({ key: "etc" }) }],
            }),
          }),
        };
      }
      if (name === "commandReceipts") {
        return {
          doc: () => ({
            collection: () => ({
              doc: () => ({
                get: async () => ({
                  exists: true,
                  data: () => ({ result: receiptResult }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected collection read: ${name}`);
    },
  } as unknown as firestore.Firestore;

  const handlers = createLedgerHouseholdCommandHandlers(database);
  const execute = (command: string, payload: Record<string, unknown>) =>
    handlers.get(command)!.execute({
      envelope: {
        contractVersion: "household-command.v1",
        commandId: `command-${command}`,
        idempotencyKey: `command-${command}`,
        householdId: "household-1",
        command,
        payload,
      },
      principalUid: "uid-1",
      actor: {
        principalUid: "uid-1",
        householdId: "household-1",
        actingMemberId: "member-1",
        capabilities: [],
      },
      requestedAt: "2026-07-22T12:00:00.000Z",
    } satisfies HouseholdCommandExecutionContext);

  return { execute, categoryReads: () => categoryReads };
}

describe("Ledger command category lookup boundary", () => {
  it.each([
    [
      "memo update",
      "ledger.update-transaction.v1",
      { transactionId: "transaction-1", expectedVersion: 1, patch: { memo: "변경" } },
    ],
    [
      "delete",
      "ledger.delete-transaction.v1",
      { transactionId: "transaction-1", expectedVersion: 1 },
    ],
    [
      "notification request",
      "ledger.request-notification.v1",
      { transactionId: "transaction-1", expectedVersion: 1 },
    ],
  ])("%s does not scan the category catalog", async (_case, command, payload) => {
    const fixture = subject();

    await fixture.execute(command, payload);

    expect(fixture.categoryReads()).toBe(0);
  });

  it("validates an explicit category change against the active catalog", async () => {
    const fixture = subject();

    await fixture.execute("ledger.update-transaction.v1", {
      transactionId: "transaction-1",
      expectedVersion: 1,
      patch: { categoryId: "etc" },
    });

    expect(fixture.categoryReads()).toBe(1);
  });
});

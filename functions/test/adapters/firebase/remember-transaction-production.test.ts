import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";
import { createLedgerHouseholdCommandHandlers } from "../../../src/bootstrap/commands/ledgerHouseholdCommandHandlers";
import type { HouseholdCommandExecutionContext } from "../../../src/bootstrap/commands/householdCommand";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

const householdId = "remember-house";
const canonical = `households/${householdId}/ledgerTransactions/expense`;
function setup() {
  const memory = new InMemoryFirestore();
  memory.seed(canonical, { householdId, transactionType: "expense", merchant: "편집 표시명", originalMerchant: " 원 가맹점 ", amountInWon: 1000, categoryId: "etc", accountingDate: "2026-09-06", lifecycleState: "active", aggregateVersion: 3, creatorMemberId: "member" });
  memory.seed("categories/food", { householdId, key: "food", isActive: true });
  const execute = (payload: Record<string, unknown>, commandId = "edit", actorHousehold = householdId) => {
    const context: HouseholdCommandExecutionContext = {
      principalUid: "uid", requestedAt: "2026-09-06T05:00:00.000Z",
      actor: { principalUid: "uid", householdId: actorHousehold, actingMemberId: "member", capabilities: ["household.read", "household.write"] },
      envelope: { contractVersion: "household-command.v1", command: "ledger.update-transaction.v1", commandId, idempotencyKey: commandId, householdId: actorHousehold, payload },
    };
    return createLedgerHouseholdCommandHandlers(memory as unknown as Firestore).get(context.envelope.command)!.execute(context);
  };
  return { memory, execute };
}
const payload = { transactionId: "expense", expectedVersion: 3, patch: { categoryId: "food", merchant: "새 표시명" }, rememberForNextTime: true };

describe("[MER-005] production transaction and remembered rule unit of work", () => {
  it("updates existing expense and immutable original merchant exact rule/claim once, replaying the receipt", async () => {
    const { memory, execute } = setup();
    const first = await execute(payload);
    expect(await execute(payload)).toEqual(first);
    expect(memory.document(canonical)).toMatchObject({ categoryId: "food", merchant: "새 표시명", originalMerchant: " 원 가맹점 ", aggregateVersion: 4 });
    expect(memory.documentsInCollection(`households/${householdId}/merchantRules`).map(({ value }) => value)).toEqual([expect.objectContaining({ keyword: "원 가맹점", mapping: { categoryId: "food" }, matchType: "exact", aggregateVersion: 1 })]);
    expect(memory.documentsInCollection(`households/${householdId}/merchantRuleClaims`)).toHaveLength(1);
    expect(memory.documentsInCollection("merchant_rules")).toHaveLength(1);
    expect(memory.documentsInCollection("outboxEvents")).toHaveLength(1);
  });

  it.each(["stale", "missing", "income", "foreign", "commit-failure"])("keeps transaction, rule, claim, outbox and receipt unchanged on %s", async (kind) => {
    const { memory, execute } = setup();
    if (kind === "income") memory.seed(canonical, { ...memory.document(canonical), transactionType: "income" });
    const before = memory.paths().map((path) => [path, memory.document(path)]);
    if (kind === "commit-failure") {
      const original = memory.runTransaction.bind(memory);
      vi.spyOn(memory, "runTransaction").mockImplementation((operation) => original(async (transaction) => { await operation(transaction); throw new Error("commit aborted after staging writes"); }));
    }
    await expect(execute({ ...payload, ...(kind === "stale" ? { expectedVersion: 2 } : {}), ...(kind === "missing" ? { transactionId: "missing" } : {}) }, "edit", kind === "foreign" ? "another" : householdId)).rejects.toThrow();
    expect(memory.paths().map((path) => [path, memory.document(path)])).toEqual(before);
  });

  it("reuses an existing exact OR claim without changing its mapping or version", async () => {
    const { memory, execute } = setup();
    memory.seed(`households/${householdId}/merchantRules/existing`, { householdId, keyword: "원 가맹점,다른곳", matchType: "exact", mapping: { categoryId: "etc" }, active: false, aggregateVersion: 7 });
    const before = memory.document(`households/${householdId}/merchantRules/existing`);
    await execute(payload);
    expect(memory.document(`households/${householdId}/merchantRules/existing`)).toEqual(before);
    expect(memory.documentsInCollection(`households/${householdId}/merchantRules`)).toHaveLength(1);
    expect(memory.document(canonical)).toMatchObject({ categoryId: "food", aggregateVersion: 4 });
  });
});

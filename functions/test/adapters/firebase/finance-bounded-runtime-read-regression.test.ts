import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { FirebaseRecurringFinanceUnitOfWork } from "../../../src/adapters/firebase/recurring/firebaseRecurringFinanceUnitOfWork";
import { createRecurringSchedulerWorkflowApplication } from "../../../src/contexts/household-finance/recurring/application/recurringSchedulerWorkflowApplication";
import { FirebaseDividendHoldingQuery } from "../../../src/adapters/firebase/portfolio/firebaseDividendHoldingQuery";
import { FirebaseDividendEventRuntimeRepository } from "../../../src/adapters/firebase/dividends/firebaseDividendEventRuntimeRepository";
import { createPortfolioHouseholdCommandHandlers } from "../../../src/bootstrap/commands/portfolioHouseholdCommandHandlers";
import type { HouseholdCommandExecutionContext } from "../../../src/bootstrap/commands/householdCommand";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

describe("Finance production query boundaries", () => {
  it("updates one Asset without loading other Assets or any Position collection", async () => {
    const memory = new InMemoryFirestore();
    const handlers = createPortfolioHouseholdCommandHandlers(memory as unknown as Firestore);
    const execute = (command: string, payload: Record<string, unknown>, commandId: string) => handlers.get(command)!.execute({ principalUid: "uid", requestedAt: "2026-09-06T00:00:00Z", actor: { principalUid: "uid", householdId: "house", actingMemberId: "member", capabilities: ["household.write"] }, envelope: { contractVersion: "household-command.v1", householdId: "house", command, commandId, idempotencyKey: commandId, payload } } as HouseholdCommandExecutionContext);
    const created = await execute("portfolio.create-asset.v1", { asset: { name: "Account", type: "stock", ownerRef: { kind: "household" }, currency: "KRW", currentBalance: 0, memo: "" } }, "create") as { assetId: string };
    for (let index = 0; index < 100; index += 1) memory.seed(`households/house/assets/other-${index}`, { householdId: "house", name: "Other", lifecycleState: "active" });
    memory.clearTransactionReads();
    await execute("portfolio.update-asset.v1", { assetId: created.assetId, expectedVersion: 1, changes: { name: "Renamed" } }, "rename");
    expect(memory.document(`households/house/assets/${created.assetId}`)?.name).toBe("Renamed");
    expect(memory.transactionReads().filter(read => read.path.includes("positions") || read.path === "households/house/assets" || read.path === "assets" || read.path.includes("holdings"))).toEqual([]);
    expect(memory.transactionReads()).toHaveLength(5);
  });

  it("pages missing months and advances only a contiguous completion checkpoint", async () => {
    const memory = new InMemoryFirestore();
    const plan = { householdId: "house", planId: "plan", merchant: "Recurring", categoryId: "fixed", amountInWon: 1000, dayOfMonth: 1, creatorMemberId: "member", firstApplicableMonth: "2026-07", active: true, lifecycleState: "active", version: 1 };
    memory.seed("households/house/recurringPlans/plan", plan);
    const unitOfWork = new FirebaseRecurringFinanceUnitOfWork(memory as unknown as Firestore);
    const app = createRecurringSchedulerWorkflowApplication({ unitOfWork, clock: { now: () => "2026-09-06T00:00:00Z", localDate: () => "2026-09-06" }, ids: { transactionId: key => `ledger-${key}`, eventId: (key, type) => `${key}-${type}` }, events: { async publish() {} } });
    const actor = { kind: "system" as const, capabilities: ["recurring.process" as const] };
    await app.processMonth({ actor, householdId: "house", planId: "plan", targetMonth: "2026-09" });
    expect(memory.document("households/house/recurringPlans/plan")?.processedThroughMonth).toBeUndefined();
    const input = { actor, asOfDate: "2026-09-06", householdZoneId: "Asia/Seoul" as const, limit: 2 };
    const first = await app.processDue(input);
    expect(first).toMatchObject({ kind: "success", completed: false, results: [{ targetMonth: "2026-07", kind: "created" }, { targetMonth: "2026-08", kind: "created" }] });
    if (first.kind !== "success") throw new Error("unexpected result");
    const second = await app.processDue({ ...input, checkpoint: first.nextCheckpoint });
    expect(second).toMatchObject({ kind: "success", results: [{ targetMonth: "2026-09", kind: "already-processed" }] });
    expect(memory.document("households/house/recurringPlans/plan")?.processedThroughMonth).toBe("2026-09");
    memory.clearTransactionReads();
    const nextOccurrence = await app.processDue(input);
    expect(nextOccurrence).toMatchObject({ kind: "success", results: [] });
    expect(memory.transactionReads()).toEqual([]);
    expect(memory.paths("expenses/")).toHaveLength(3);
  });

  it("keeps a complete dividend target at a page boundary and progresses past terminal events", async () => {
    const memory = new InMemoryFirestore();
    for (const [assetId, code] of [["a", "ETF1"], ["b", "ETF1"], ["c", "ETF2"]]) {
      memory.seed(`households/house/assets/${assetId}`, { lifecycleState: "active" });
      memory.seed(`households/house/assets/${assetId}/positions/p`, { householdId: "house", assetId, instrumentCode: code, instrumentName: code, instrumentType: "etf", market: "KRX", lifecycleState: "active", quantity: 2, aggregateVersion: 1 });
    }
    const holdings = new FirebaseDividendHoldingQuery(memory as unknown as Firestore);
    const first = await holdings.listActiveKrxEtfTargets({ limit: 1 });
    expect(first.items).toMatchObject([{ instrument: { code: "ETF1" }, sourceAssetIds: ["a", "b"] }]);
    const second = await holdings.listActiveKrxEtfTargets({ limit: 1, cursor: first.nextCursor });
    expect(second.items).toMatchObject([{ instrument: { code: "ETF2" }, sourceAssetIds: ["c"] }]);
    memory.seed("dividend_events/a-paid", { status: "paid" });
    memory.seed("dividend_events/b-fixed", { eventId: "b-fixed", householdId: "house", instrumentCode: "ETF1", instrumentName: "ETF1", sourceAssetIds: ["a"], recordDate: "2026-09-01", paymentDate: "2026-09-20", perShareAmount: 100, status: "fixed", eligibleQuantity: 2, totalAmount: 200, aggregateVersion: 2 });
    const events = new FirebaseDividendEventRuntimeRepository(memory as unknown as Firestore);
    expect(await events.listNonterminal({ limit: 1 })).toEqual({ items: [], nextCursor: "a-paid" });
    expect((await events.listNonterminal({ limit: 1, cursor: "a-paid" })).items).toHaveLength(1);
  });
});

import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { createCategoryHouseholdCommandHandlers } from "../../../src/bootstrap/commands/categoryHouseholdCommandHandlers";
import { createRecurringHouseholdCommandHandlers } from "../../../src/bootstrap/commands/recurringHouseholdCommandHandlers";
import { createPortfolioHouseholdCommandHandlers } from "../../../src/bootstrap/commands/portfolioHouseholdCommandHandlers";
import type { HouseholdCommandExecutionContext, HouseholdCommandHandler } from "../../../src/bootstrap/commands/householdCommand";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

function execute(handlers: ReadonlyMap<string, HouseholdCommandHandler>, command: string, payload: Record<string, unknown>, id: string) {
  const context: HouseholdCommandExecutionContext = { principalUid: "uid", requestedAt: "2026-09-06T00:00:00Z", actor: { principalUid: "uid", householdId: "house", actingMemberId: "member", capabilities: ["household.read", "household.write"] }, envelope: { contractVersion: "household-command.v1", householdId: "house", command, commandId: id, idempotencyKey: id, payload } };
  return handlers.get(command)!.execute(context);
}

describe("Finance configuration client version boundary", () => {
  it("requires the parent Asset version for a Position edit and every Asset version for reordering", async () => {
    const memory = new InMemoryFirestore();
    const handlers = createPortfolioHouseholdCommandHandlers(memory as unknown as Firestore);
    const created = await execute(handlers, "portfolio.create-asset.v1", { asset: { name: "계좌", type: "stock", ownerRef: { kind: "household" }, currency: "KRW", currentBalance: 0, memo: "", order: 0, isActive: true } }, "asset") as { assetId: string };
    const { assetId } = created;
    const added = await execute(handlers, "portfolio.add-position.v1", { assetId, positionKind: "stock", expectedAssetVersion: 1, position: { assetId, stockCode: "005930", stockName: "삼성", market: "KRX", quantity: 3, avgPrice: 1000 } }, "position") as { positionId: string };
    const path = `households/house/assets/${assetId}`;
    const before = memory.document(path);
    const events = memory.paths("outboxEvents/");
    await expect(execute(handlers, "portfolio.update-position.v1", { assetId, positionId: added.positionId, positionKind: "stock", expectedVersion: 1, expectedAssetVersion: 1, changes: { quantity: 9 } }, "stale-position")).rejects.toThrow("ASSET_VERSION_MISMATCH");
    await expect(execute(handlers, "portfolio.reorder-assets.v1", { assets: [{ assetId, order: 0 }], expectedVersions: { [assetId]: 1 } }, "stale-order")).rejects.toThrow("ASSET_VERSION_MISMATCH");
    expect(memory.document(path)).toEqual(before);
    expect(memory.document(`${path}/positions/${added.positionId}`)).toMatchObject({ quantity: 3, aggregateVersion: 1 });
    expect(memory.paths("outboxEvents/")).toEqual(events);
  });

  it("rejects a stale category edit instead of substituting the server version", async () => {
    const memory = new InMemoryFirestore();
    memory.seed("households/house/categories/food", { householdId: "house", categoryId: "food", name: "식비", color: "#FFFFFF", state: "active", sortOrder: 0, version: 2 });
    const handlers = createCategoryHouseholdCommandHandlers(memory as unknown as Firestore);
    await expect(execute(handlers, "category.update.v1", { categoryId: "food", expectedVersion: 1, changes: { label: "stale" } }, "stale")).rejects.toThrow();
    expect(memory.document("households/house/categories/food")).toMatchObject({ name: "식비", version: 2 });
    await expect(execute(handlers, "category.update.v1", { categoryId: "food", expectedVersion: 2, changes: { label: "fresh" } }, "fresh")).resolves.toEqual({});
    expect(memory.document("households/house/categories/food")).toMatchObject({ name: "fresh", version: 3 });
  });

  it("rejects stale recurring edit and deletion without changing the plan", async () => {
    const memory = new InMemoryFirestore();
    memory.seed("households/house/recurringPlans/plan", { householdId: "house", merchant: "정기", categoryId: "food", amountInWon: 1000, dayOfMonth: 10, creatorMemberId: "member", firstApplicableMonth: "2026-09", lifecycleState: "active", active: true, version: 2, createdAt: "2026-09-01T00:00:00Z" });
    const handlers = createRecurringHouseholdCommandHandlers(memory as unknown as Firestore);
    for (const command of ["recurring.update-plan.v1", "recurring.delete-plan.v1"]) await expect(execute(handlers, command, { planId: "plan", expectedVersion: 1, changes: { memo: "stale" } }, command)).rejects.toThrow();
    expect(memory.document("households/house/recurringPlans/plan")).toMatchObject({ lifecycleState: "active", version: 2 });
  });

  it("finishes category archive remapping active and paused plans without rewriting historical ledger categories", async () => {
    const memory = new InMemoryFirestore();
    memory.seed("households/house/categorySettings/default", { defaultCategoryId: "etc", catalogVersion: 1 });
    for (const categoryId of ["food", "etc"]) memory.seed(`households/house/categories/${categoryId}`, { householdId: "house", categoryId, name: categoryId, color: "#FFFFFF", state: "active", sortOrder: categoryId === "food" ? 0 : 1, version: 1 });
    for (const active of [true, false]) memory.seed(`households/house/recurringPlans/${active}`, { householdId: "house", categoryId: "food", merchant: "plan", amountInWon: 1000, dayOfMonth: 10, active, lifecycleState: "active", version: 1 });
    memory.seed("expenses/history", { householdId: "house", category: "food" });
    const handlers = createCategoryHouseholdCommandHandlers(memory as unknown as Firestore);
    await expect(execute(handlers, "category.archive.v1", { categoryId: "food", expectedVersion: 1 }, "archive")).resolves.toEqual({});
    expect(memory.document("households/house/categories/food")).toMatchObject({ state: "archived" });
    for (const active of [true, false]) expect(memory.document(`households/house/recurringPlans/${active}`)).toMatchObject({ categoryId: "etc", version: 2, active });
    expect(memory.document("expenses/history")).toMatchObject({ category: "food" });
    await execute(handlers, "category.archive.v1", { categoryId: "food", expectedVersion: 1 }, "archive");
    expect(memory.document("households/house/recurringPlans/true")).toMatchObject({ version: 2 });
  });
});

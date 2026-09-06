import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { FirebaseDividendHoldingQuery } from "../../../src/adapters/firebase/portfolio/firebaseDividendHoldingQuery";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

describe("Dividend discovery active Asset boundary", () => {
  it("excludes an active Position whose canonical parent is deleted, including stale legacy parent data", async () => {
    const memory = new InMemoryFirestore();
    for (const [id, lifecycleState] of [["active", "active"], ["deleted", "deleted"]]) {
      memory.seed(`households/house/assets/${id}`, { householdId: "house", lifecycleState });
      memory.seed(`assets/${id}`, { householdId: "house", isActive: true });
      memory.seed(`households/house/assets/${id}/positions/etf`, { householdId: "house", assetId: id, market: "KRX", instrumentType: "etf", instrumentCode: "102110", instrumentName: "ETF", quantity: 3, lifecycleState: "active", aggregateVersion: 1 });
    }
    const page = await new FirebaseDividendHoldingQuery(memory as unknown as Firestore).listActiveKrxEtfTargets({ limit: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.sourceAssetIds).toEqual(["active"]);
  });
});

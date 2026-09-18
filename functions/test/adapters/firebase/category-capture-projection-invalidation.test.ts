import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { FirebaseCategoryCatalogStore } from "../../../src/adapters/firebase/categories/firebaseCategoryCatalogStore";
import { categoryCatalogDocument } from "../../support/category-catalog-document";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

const projectionPath =
  "households/house-1/runtimeProjections/payment-capture-configuration-v1";

describe("Firebase category capture projection invalidation", () => {
  it("카테고리 계약이 바뀌는 동일 트랜잭션에서 수집 설정 projection을 무효화한다", async () => {
    const memory = new InMemoryFirestore();
    memory.seed("households/house-1", {
      defaultCategoryKey: "etc",
    });
    memory.seed("households/house-1/categoryCatalog/current", categoryCatalogDocument("house-1", [
      { categoryId: "etc", name: "기타", color: "#000000" },
    ], { defaultCategoryId: "etc" }));
    memory.seed(projectionPath, {
      householdId: "house-1",
      schemaVersion: 1,
    });
    const store = new FirebaseCategoryCatalogStore(
      memory as unknown as firestore.Firestore,
      {
        householdId: "house-1",
        principalUid: "uid-1",
        commandId: "command-1",
        payloadFingerprint: "payload-1",
        requestedAt: "2026-07-23T00:00:00.000Z",
      },
    );

    await store.transact((current) => ({
      state: {
        ...current,
        categories: current.categories.map((category) => ({
          ...category,
          name: "기타 지출",
          version: category.version + 1,
        })),
        catalogVersion: current.catalogVersion + 1,
      },
      value: { kind: "success" as const },
    }));

    expect(memory.has(projectionPath)).toBe(false);
  });

  it("Catalog 크기 초과는 원본·수집 설정·receipt·outbox를 변경하지 않고 거부한다", async () => {
    const memory = new InMemoryFirestore();
    const catalogPath = "households/house-1/categoryCatalog/current";
    const catalog = categoryCatalogDocument("house-1", [{ categoryId: "etc" }], { defaultCategoryId: "etc" });
    memory.seed("households/house-1", { lifecycleState: "active" });
    memory.seed(catalogPath, catalog);
    memory.seed(projectionPath, { householdId: "house-1", schemaVersion: 1 });
    const store = new FirebaseCategoryCatalogStore(memory as unknown as firestore.Firestore, {
      householdId: "house-1", principalUid: "uid-1", commandId: "oversized-command",
      payloadFingerprint: "oversized-payload", requestedAt: "2026-09-18T00:00:00.000Z",
    });

    await expect(store.transact(current => ({
      state: { ...current, catalogVersion: current.catalogVersion + 1,
        categories: current.categories.map(category => ({ ...category, name: "가".repeat(270_000), version: category.version + 1 })),
      },
      value: { kind: "success" as const },
    }))).rejects.toThrow("CATEGORY_CATALOG_TOO_LARGE");

    expect(memory.document(catalogPath)).toEqual(catalog);
    expect(memory.has(projectionPath)).toBe(true);
    expect(memory.documentsInCollection("commandReceipts/household-finance-category-catalog/receipts")).toHaveLength(0);
    expect(memory.documentsInCollection("outboxEvents")).toHaveLength(0);
  });
});

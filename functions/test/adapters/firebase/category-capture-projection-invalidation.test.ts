import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { FirebaseCategoryCatalogStore } from "../../../src/adapters/firebase/categories/firebaseCategoryCatalogStore";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

const projectionPath =
  "households/house-1/runtimeProjections/payment-capture-configuration-v1";

describe("Firebase category capture projection invalidation", () => {
  it("카테고리 계약이 바뀌는 동일 트랜잭션에서 수집 설정 projection을 무효화한다", async () => {
    const memory = new InMemoryFirestore();
    memory.seed("households/house-1", {
      defaultCategoryKey: "etc",
    });
    memory.seed("households/house-1/categorySettings/default", {
      defaultCategoryId: "etc",
      catalogVersion: 1,
    });
    memory.seed("households/house-1/categories/etc", {
      householdId: "house-1",
      categoryId: "etc",
      name: "기타",
      color: "#000000",
      budgetInWon: null,
      state: "active",
      sortOrder: 0,
      version: 1,
    });
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
});

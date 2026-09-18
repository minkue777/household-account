import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";
import { readUsableCategoryIds } from "../../../src/adapters/firebase/categories/firebaseCategoryReferenceReader";
import { categoryCatalogDocument } from "../../support/category-catalog-document";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

describe("Category가 소유하는 신규 참조 판정", () => {
  it("단일 catalog의 활성 category와 그 별칭만 허용하고 보관 상태는 제외한다", async () => {
    const memory = new InMemoryFirestore();
    memory.seed("households/house/categoryCatalog/current", categoryCatalogDocument("house", [
      { categoryId: "food", state: "archive-pending" }, { categoryId: "living" },
      { categoryId: "archived", state: "archived" }, { categoryId: "current" },
    ], { categoryAliases: { "legacy-food": "food", "legacy-living": "living" } }));
    memory.seed("categories/ignored-legacy", { householdId: "house", key: "ignored" });
    memory.seed("households/other/categoryCatalog/current", categoryCatalogDocument("other", [{ categoryId: "other" }]));
    expect([...await readUsableCategoryIds(memory as unknown as Firestore, "house")].sort())
      .toEqual(["current", "legacy-living", "living"]);
  });

  it("빈 catalog와 저장소 실패를 합치지 않는다", async () => {
    const memory = new InMemoryFirestore();
    expect(await readUsableCategoryIds(memory as unknown as Firestore, "house")).toEqual(new Set());
    vi.spyOn(memory, "collection").mockImplementation(() => { throw new Error("unavailable"); });
    await expect(readUsableCategoryIds(memory as unknown as Firestore, "house")).rejects.toThrow("unavailable");
  });

  it.each([
    { schemaVersion: 2 },
    { householdId: "other" },
    { catalogVersion: -1 },
    { categories: [{ categoryId: "food" }] },
    { categories: categoryCatalogDocument("house", [{ categoryId: "food" }, { categoryId: "food" }]).categories },
    { categories: categoryCatalogDocument("house", [{ categoryId: "food", state: "archived" }]).categories, defaultCategoryId: "food" },
    { defaultCategoryId: "missing" },
    { categoryAliases: { "old-id": "missing" } },
    { categories: categoryCatalogDocument("house", [{ categoryId: "food" }, { categoryId: "etc" }]).categories, categoryAliases: { food: "etc" } },
  ])("잘못된 catalog를 빈 성공으로 바꾸지 않는다: %j", async (invalid) => {
    const memory = new InMemoryFirestore();
    memory.seed("households/house/categoryCatalog/current", {
      ...categoryCatalogDocument("house", [{ categoryId: "food" }]), ...invalid,
    });
    await expect(readUsableCategoryIds(memory as unknown as Firestore, "house")).rejects.toThrow("CATEGORY_CATALOG_INVALID");
  });
});

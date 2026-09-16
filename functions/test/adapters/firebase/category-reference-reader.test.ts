import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";
import { readUsableCategoryIds } from "../../../src/adapters/firebase/categories/firebaseCategoryReferenceReader";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

describe("Category가 소유하는 신규 참조 판정", () => {
  it("canonical 상태를 우선하고 legacy inactive·보관 진행 중·보관 완료를 제외한다", async () => {
    const memory = new InMemoryFirestore();
    memory.seed("categories/legacy-food", { householdId: "house", key: "food", isActive: true });
    memory.seed("households/house/categories/food", { categoryId: "food", state: "archive-pending" });
    memory.seed("categories/legacy-only", { householdId: "house", key: "living" });
    memory.seed("categories/inactive", { householdId: "house", key: "inactive", isActive: false });
    memory.seed("categories/other-house", { householdId: "other", key: "other" });
    memory.seed("households/house/categories/archived", { state: "archived" });
    memory.seed("households/house/categories/lifecycle-archive", { state: "", lifecycleState: "archived" });
    memory.seed("households/house/categories/legacy-lifecycle", { lifecycle: "archived" });
    memory.seed("households/house/categories/deleted", { state: "deleted" });
    memory.seed("households/house/categories/current", { state: "active" });
    expect([...await readUsableCategoryIds(memory as unknown as Firestore, "house")].sort())
      .toEqual(["current", "living"]);
  });

  it("빈 catalog와 저장소 실패를 합치지 않는다", async () => {
    const memory = new InMemoryFirestore();
    expect(await readUsableCategoryIds(memory as unknown as Firestore, "house")).toEqual(new Set());
    vi.spyOn(memory, "collection").mockImplementation(() => { throw new Error("unavailable"); });
    await expect(readUsableCategoryIds(memory as unknown as Firestore, "house")).rejects.toThrow("unavailable");
  });
});

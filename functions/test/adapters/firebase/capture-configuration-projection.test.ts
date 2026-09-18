import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { CoalescingCaptureConfigurationQuery, FirebaseCaptureConfigurationQuery } from "../../../src/adapters/firebase/payment-capture/firebaseCaptureConfigurationQuery";
import { InMemoryFirestore } from "../../support/in-memory-firestore";
import { categoryCatalogDocument } from "../../support/category-catalog-document";

const projectionPath =
  "households/house-1/runtimeProjections/payment-capture-configuration-v1";

describe("Firebase capture configuration projection", () => {
  it.each(["archive-pending", "archived"] as const)("catalog %s 상태가 업무 ID와 이전 문서 별칭의 활성 참조를 함께 제거한다", async (state) => {
    const memory = new InMemoryFirestore();
    memory.seed("categories/legacy-food", { householdId: "house-1", key: "food", isActive: true });
    memory.seed("categories/legacy-active", { householdId: "house-1", key: "active" });
    memory.seed("households/house-1/categoryCatalog/current", categoryCatalogDocument("house-1", [
      { categoryId: "food", state }, { categoryId: "active" }, { categoryId: "default" },
    ], { categoryAliases: { "legacy-food": "food", "canonical-food": "food", "legacy-active": "active" } }));
    // 구 projection은 잘못된 활성 판정을 담을 수 있으므로 서버 배포 후 다시 만듭니다.
    memory.seed(projectionPath, {
      householdId: "house-1", cards: [], merchantRules: [],
      activeCategoryIds: ["food", "legacy-food", "canonical-food"], schemaVersion: 2,
    });
    const query = new FirebaseCaptureConfigurationQuery(memory as unknown as firestore.Firestore);
    const input = { householdId: "house-1", actingMemberId: "member-1" };
    const rebuilt = await query.load(input);
    expect(rebuilt).toMatchObject({ kind: "available", value: {
      activeCategoryIds: new Set(["active", "legacy-active", "default"]),
    } });
    expect(memory.document(projectionPath)?.schemaVersion).toBe(4);
    expect(await query.load(input)).toEqual(rebuilt);
  });

  it("설정 변경으로 projection이 무효화되면 같은 warm query의 다음 요청이 새 카드·규칙·카테고리를 읽는다", async () => {
    const memory = new InMemoryFirestore();
    memory.seed("households/house-1/registeredCards/card-1", {
      ownerMemberId: "member-1", companyLabel: "국민", lastFour: "1234",
    });
    memory.seed("households/house-1/categoryCatalog/current", categoryCatalogDocument("house-1", [{ categoryId: "old-category" }]));
    memory.seed("households/house-1/merchantRules/rule-1", {
      merchantKeyword: "커피", matchType: "exact", mapping: { categoryId: "old-category" },
    });
    const query = new CoalescingCaptureConfigurationQuery(new FirebaseCaptureConfigurationQuery(memory as unknown as firestore.Firestore));
    const scope = { householdId: "house-1", actingMemberId: "member-1" };
    const before = await query.load(scope);
    expect(before).toMatchObject({ kind: "available", value: { cards: [{ lastFour: "1234" }], merchantRules: [{ mapping: { categoryId: "old-category" } }] } });
    expect(memory.has(projectionPath)).toBe(true);

    // 실제 설정 command 트랜잭션이 원본 변경과 projection 삭제를 완료한 DB 상태입니다.
    // command부터 수집까지의 연결은 payment-capture 실제 Emulator E2E에서 확인합니다.
    memory.seed("households/house-1/registeredCards/card-1", {
      ownerMemberId: "member-1", companyLabel: "국민", lastFour: "5678",
    });
    memory.seed("households/house-1/categoryCatalog/current", categoryCatalogDocument("house-1", [
      { categoryId: "old-category", state: "archived" }, { categoryId: "NewCategory", name: "간식/디저트/커피" },
    ]));
    memory.seed("households/house-1/merchantRules/rule-1", {
      merchantKeyword: "커피", matchType: "exact", mapping: { categoryId: "NewCategory" },
    });
    memory.remove(projectionPath);
    const after = await query.load(scope);
    expect(after).toMatchObject({ kind: "available", value: { cards: [{ lastFour: "5678" }], merchantRules: [{ mapping: { categoryId: "NewCategory" } }] } });
    if (after.kind !== "available") throw new Error("Expected updated capture configuration");
    expect(after.value.activeCategoryIds).toEqual(new Set(["NewCategory"]));
    expect(memory.has(projectionPath)).toBe(true);
  });
  it.each([
    [{ merchantKeyword: "shop", matchType: "regex", priority: 10 }, "REGEX_NOT_SUPPORTED"],
    [{ merchantKeyword: "shop,", matchType: "contains", priority: 10 }, "EMPTY_OR_TOKEN"],
  ])("[MER-001][MER-004] malformed canonical rule은 임의 보정/설정 projection 저장 없이 명시적으로 거부한다", async (rule, code) => {
    const memory = new InMemoryFirestore();
    memory.seed("households/house-1/merchantRules/invalid", { householdId: "house-1", mapping: { categoryId: "etc" }, ...rule });
    const before = memory.paths().map((path) => [path, memory.document(path)]);
    const result = await new FirebaseCaptureConfigurationQuery(memory as unknown as firestore.Firestore).load({ householdId: "house-1", actingMemberId: "member-1" });
    expect(result).toEqual({ kind: "contract-failure", code });
    expect(memory.paths().map((path) => [path, memory.document(path)])).toEqual(before);
  });
  it("완성된 가구별 projection 한 문서만으로 수집 설정을 읽는다", async () => {
    const memory = new InMemoryFirestore();
    memory.seed(projectionPath, {
      householdId: "house-1",
      cards: [
        {
          cardId: "card-1",
          ownerMemberId: "member-1",
          companyLabel: "국민",
          lastFour: "0027",
          lifecycleState: "active",
        },
      ],
      merchantRules: [],
      activeCategoryIds: ["etc", "food"],
      defaultCategoryId: "etc",
      schemaVersion: 4,
    });

    const result = await new FirebaseCaptureConfigurationQuery(
      memory as unknown as firestore.Firestore,
    ).load({
      householdId: "house-1",
      actingMemberId: "member-1",
    });

    expect(result).toEqual({
      kind: "available",
      value: {
        cards: [
          {
            cardId: "card-1",
            ownerMemberId: "member-1",
            companyLabel: "국민",
            lastFour: "0027",
            lifecycleState: "active",
          },
        ],
        merchantRules: [],
        activeCategoryIds: new Set(["etc", "food"]),
        defaultCategoryId: "etc",
      },
    });
    expect(memory.paths()).toEqual([projectionPath]);
  });

  it("projection이 없으면 canonical 원본만 조합하고 보존된 legacy 문서를 다시 읽지 않는다", async () => {
    const memory = new InMemoryFirestore();
    memory.seed("households/house-1", {
      defaultCategoryKey: "etc",
    });
    memory.seed("households/house-1/members/member-1", {
      displayName: "민규",
    });
    memory.seed("households/house-1/members/member-2", {
      displayName: "진선",
    });
    memory.seed("registered_cards/card-2", {
      householdId: "house-1",
      owner: "진선",
      cardLabel: "삼성",
      cardLastFour: "1876",
    });
    memory.seed("households/house-1/registeredCards/card-2", {
      householdId: "house-1", ownerMemberId: "member-2", cardCompanyCode: "삼성", lastFour: "1876", lifecycle: "active",
    });
    memory.seed("merchant_rules/stale", { householdId: "house-1", merchantKeyword: "shop", exactMatch: true, category: "food" });
    memory.seed("households/house-1/categoryCatalog/current", categoryCatalogDocument("house-1", [{ categoryId: "etc" }], { defaultCategoryId: "etc" }));
    memory.seed("categories/etc", {
      householdId: "house-1",
      key: "etc",
      label: "기타",
      color: "#000000",
      isActive: true,
    });

    const result = await new FirebaseCaptureConfigurationQuery(
      memory as unknown as firestore.Firestore,
    ).load({
      householdId: "house-1",
      actingMemberId: "member-1",
    });

    expect(result.kind).toBe("available");
    if (result.kind !== "available") return;
    expect(result.value.cards).toEqual([
      {
        cardId: "card-2",
        ownerMemberId: "member-2",
        companyLabel: "삼성",
        lastFour: "1876",
        lifecycleState: "active",
      },
    ]);
    expect(result.value.activeCategoryIds).toEqual(new Set(["etc"]));
    expect(result.value.merchantRules).toEqual([]);
    expect(memory.transactionReads().map(({ path }) => path)).not.toEqual(expect.arrayContaining([
      "registered_cards", "merchant_rules", "categories", "households/house-1/members", "households/house-1/categories",
    ]));
    expect(memory.has(projectionPath)).toBe(true);

    memory.remove("households/house-1/registeredCards/card-2");
    memory.remove("households/house-1/categoryCatalog/current");
    const projected = await new FirebaseCaptureConfigurationQuery(
      memory as unknown as firestore.Firestore,
    ).load({
      householdId: "house-1",
      actingMemberId: "member-2",
    });
    expect(projected).toEqual(result);
  });
});

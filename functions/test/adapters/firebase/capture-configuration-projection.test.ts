import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { FirebaseCaptureConfigurationQuery } from "../../../src/adapters/firebase/payment-capture/firebaseCaptureConfigurationQuery";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

const projectionPath =
  "households/house-1/runtimeProjections/payment-capture-configuration-v1";

describe("Firebase capture configuration projection", () => {
  it.each([
    [{ merchantKeyword: "shop", matchType: "regex", priority: 10 }, "REGEX_NOT_SUPPORTED"],
    [{ merchantKeyword: "shop,", matchType: "contains", priority: 10 }, "EMPTY_OR_TOKEN"],
  ])("[MER-001][MER-004] malformed legacy rule은 임의 보정/설정 projection 저장 없이 명시적으로 거부한다", async (rule, code) => {
    const memory = new InMemoryFirestore();
    memory.seed("merchant_rules/invalid", { householdId: "house-1", category: "etc", ...rule });
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
      schemaVersion: 2,
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

  it("projection이 없으면 원본을 한 번 조합하고 모든 가구원의 이름을 안정 ID로 정규화한다", async () => {
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
    expect(memory.has(projectionPath)).toBe(true);

    memory.remove("registered_cards/card-2");
    memory.remove("categories/etc");
    const projected = await new FirebaseCaptureConfigurationQuery(
      memory as unknown as firestore.Firestore,
    ).load({
      householdId: "house-1",
      actingMemberId: "member-2",
    });
    expect(projected).toEqual(result);
  });
});

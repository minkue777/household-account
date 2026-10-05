import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FirebasePaymentConfigurationAtomicStore } from "../../../src/adapters/firebase/payment-configuration/firebasePaymentConfigurationAtomicStore";
import { createPaymentConfigurationRuntimeApplication } from "../../../src/contexts/payment-capture/configuration/application/paymentConfigurationRuntimeApplication";
import { createMerchantRuleCategoryArchiveApplication } from "../../../src/contexts/payment-capture/configuration/application/merchantRuleCategoryArchiveApplication";

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeWithEmulator("[MER-004] 실제 규칙 저장의 원자성·경합·재전송", () => {
  let app: ReturnType<typeof initializeApp>;
  let database: ReturnType<typeof getFirestore>;
  let application: ReturnType<typeof createPaymentConfigurationRuntimeApplication>;

  beforeAll(async () => {
    app = initializeApp({ projectId: "demo-merchant-mutation" }, "merchant-mutation-test");
    database = getFirestore(app);
    await database.recursiveDelete(database.collection("households"));
    await database.recursiveDelete(database.collection("commandReceipts"));
    application = createPaymentConfigurationRuntimeApplication(new FirebasePaymentConfigurationAtomicStore(database));
  });
  afterAll(async () => { if (app) await deleteApp(app); });

  const command = (householdId: string, id: string, action: string) => ({
    actor: { householdId, memberId: "member" }, commandId: id, idempotencyKey: id,
    commandName: `payment-configuration.${action}-merchant-rule.v1`, payloadFingerprint: id,
    occurredAt: "2026-10-05T00:00:00.000Z",
  });
  const create = async (householdId: string, id: string, type = "contains") => {
    const result = await application.createMerchantRule({ ...command(householdId, id, "create"),
      rule: { merchantKeyword: id, matchType: type, mapping: { memo: "원래 메모" } } });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error("Rule creation failed");
    return result.value.ruleId as string;
  };

  it("[MER-007][T-CAT-004] 카테고리 변경 101개를 두 페이지로 저장하고 재개는 기존 receipt를 재생한다", async () => {
    const householdId = "category-pages";
    const rules = database.collection(`households/${householdId}/merchantRules`);
    const batch = database.batch();
    for (let index = 0; index < 101; index++) batch.set(rules.doc(String(index).padStart(3, "0")), {
      householdId, keyword: `가게${index}`, matchType: "contains", priority: index + 1, active: index % 2 === 0,
      mapping: { categoryId: "old", merchant: "가맹점 보존", memo: "메모 보존" }, aggregateVersion: 1,
    });
    await batch.commit();
    const archive = createMerchantRuleCategoryArchiveApplication(new FirebasePaymentConfigurationAtomicStore(database));
    const input = { householdId, processId: "archive", sourceCategoryId: "old", destinationCategoryId: "default", occurredAt: "2026-10-05T00:00:00.000Z" };
    expect(await archive.remap(input)).toEqual({ kind: "success" });
    const saved = (await rules.get()).docs.map(doc => doc.data());
    expect(saved).toHaveLength(101);
    for (const rule of saved) expect(rule).toMatchObject({ aggregateVersion: 2, mapping: {
      categoryId: "default", merchant: "가맹점 보존", memo: "메모 보존",
    } });
    expect(await archive.remap(input)).toEqual({ kind: "success" });
    expect((await rules.get()).docs.map(doc => doc.data())).toEqual(saved);
    expect((await database.collection("commandReceipts/payment-configuration/receipts").where("householdId", "==", householdId).get()).size).toBe(2);
  });

  it("같은 exact OR 토큰 생성 경합에서 한 규칙만 저장하고 receipt 재생·payload 충돌은 상태를 바꾸지 않는다", async () => {
    const householdId = "exact-race";
    const requests = ["카페,공통", "공통,식당"].map((merchantKeyword, index) => ({
      ...command(householdId, `create-${index}`, "create"),
      rule: { merchantKeyword, matchType: "exact", mapping: {} },
    }));
    const results = await Promise.all(requests.map(input => application.createMerchantRule(input)));
    expect(results.filter(result => result.kind === "success")).toHaveLength(1);
    expect(results.filter(result => result.kind === "rejected")).toEqual([
      { kind: "rejected", code: "EXACT_KEYWORD_CONFLICT" },
    ]);
    const household = database.collection("households").doc(householdId);
    const rules = await household.collection("merchantRules").get();
    const claims = await household.collection("merchantRuleClaims").get();
    expect(rules.size).toBe(1);
    expect(claims.size).toBe(2);
    expect(claims.docs.every(doc => doc.get("ruleId") === rules.docs[0].id)).toBe(true);
    const before = rules.docs[0].data();
    for (let index = 0; index < requests.length; index++) {
      expect(await application.createMerchantRule(requests[index])).toEqual(results[index]);
    }
    expect(await application.createMerchantRule({ ...requests[0], payloadFingerprint: "different" }))
      .toEqual({ kind: "rejected", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
    expect((await rules.docs[0].ref.get()).data()).toEqual(before);
    expect((await database.collection("commandReceipts/payment-configuration/receipts")
      .where("householdId", "==", householdId).get()).size).toBe(2);
  });

  it("같은 version 수정 경합에서 한 변경만 반영하고 늦은 수정과 재전송이 덮어쓰지 않는다", async () => {
    const householdId = "update-race";
    const ruleId = await create(householdId, "카페", "exact");
    const requests = ["수정 A", "수정 B"].map((memo, index) => ({
      ...command(householdId, `update-${index}`, "update"), ruleId, expectedVersion: 1,
      changes: { mapping: { memo } },
    }));
    const results = await Promise.all(requests.map(input => application.updateMerchantRule(input)));
    const winner = results.findIndex(result => result.kind === "success");
    expect(winner).toBeGreaterThanOrEqual(0);
    expect(results.filter(result => result.kind === "success")).toHaveLength(1);
    expect(results.filter(result => result.kind === "rejected"))
      .toEqual([{ kind: "rejected", code: "VERSION_MISMATCH" }]);
    const reference = database.doc(`households/${householdId}/merchantRules/${ruleId}`);
    const saved = (await reference.get()).data();
    expect(saved).toMatchObject({ aggregateVersion: 2, mapping: requests[winner].changes.mapping });
    for (let index = 0; index < requests.length; index++) {
      expect(await application.updateMerchantRule(requests[index])).toEqual(results[index]);
    }
    expect((await reference.get()).data()).toEqual(saved);
  });

  it("순서·종류 변경·삭제는 본문과 claim·collection version을 함께 바꾸고 제거한 토큰은 재사용된다", async () => {
    const householdId = "rule-lifecycle";
    const firstId = await create(householdId, "카페");
    const secondId = await create(householdId, "식당");
    const household = database.collection("households").doc(householdId);
    const rules = household.collection("merchantRules");
    const meta = household.collection("paymentConfigurationMeta").doc("merchant-rules");
    const reorder = { ...command(householdId, "reorder", "reorder"),
      matchType: "contains" as const, orderedRuleIds: [firstId, secondId], expectedCollectionVersion: 2 };
    expect(await application.reorderMerchantRules(reorder)).toEqual({ kind: "success", value: {} });
    expect((await rules.doc(firstId).get()).data()).toMatchObject({ priority: 20, aggregateVersion: 2 });
    expect((await rules.doc(secondId).get()).data()).toMatchObject({ priority: 10, aggregateVersion: 2 });
    expect(await application.reorderMerchantRules({ ...reorder, ...command(householdId, "stale", "reorder") }))
      .toEqual({ kind: "rejected", code: "VERSION_MISMATCH" });
    expect((await meta.get()).get("collectionVersions")).toEqual({ [`${householdId}:contains`]: 3 });

    expect(await application.updateMerchantRule({ ...command(householdId, "exact", "update"),
      ruleId: firstId, expectedVersion: 2, changes: { matchType: "exact", merchantKeyword: "새이름,두번째" } }))
      .toEqual({ kind: "success", value: {} });
    const exact = (await rules.doc(firstId).get()).data();
    expect(exact).toMatchObject({ matchType: "exact", aggregateVersion: 3, mapping: { memo: "원래 메모" } });
    expect(exact).not.toHaveProperty("priority");
    expect((await household.collection("merchantRuleClaims").get()).size).toBe(3);
    expect((await meta.get()).get("collectionVersions")).toEqual({ [`${householdId}:contains`]: 4 });

    expect(await application.deleteMerchantRule({ ...command(householdId, "delete", "delete"),
      ruleId: firstId, expectedVersion: 3 })).toEqual({ kind: "success", value: {} });
    expect((await rules.doc(firstId).get()).exists).toBe(false);
    const claims = await household.collection("merchantRuleClaims").get();
    expect(claims.size).toBe(1);
    expect(claims.docs[0].get("ruleId")).toBe(secondId);
    await create(householdId, "새이름", "exact");
    expect((await rules.get()).size).toBe(2);
  });
});

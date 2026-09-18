import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FirebasePaymentConfigurationAtomicStore } from "../../../src/adapters/firebase/payment-configuration/firebasePaymentConfigurationAtomicStore";
import { createPaymentConfigurationRuntimeApplication } from "../../../src/contexts/payment-capture/configuration/application/paymentConfigurationRuntimeApplication";
import { createPaymentConfigurationHouseholdCommandHandlers } from "../../../src/bootstrap/commands/paymentConfigurationHouseholdCommandHandlers";
import { FirebaseCaptureConfigurationQuery } from "../../../src/adapters/firebase/payment-capture/firebaseCaptureConfigurationQuery";

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeWithEmulator("[MER-003] Firestore 가맹점 치환 수정", () => {
  const householdId = "merchant-mapping-patch";
  let app: ReturnType<typeof initializeApp>;
  let database: ReturnType<typeof getFirestore>;

  beforeAll(async () => {
    app = initializeApp({ projectId: "demo-household-account-mapping" }, "merchant-mapping-test");
    database = getFirestore(app);
    await database.recursiveDelete(database.collection("households").doc(householdId));
    await database.recursiveDelete(database.collection("merchant_rules"));
    await database.recursiveDelete(database.collection("commandReceipts"));
    await database.doc(`households/${householdId}/members/member`).set({ displayName: "사용자", lifecycleState: "active" });
  });
  afterAll(async () => { if (app) await deleteApp(app); });

  it("가맹점 치환을 지워도 memo와 createdAt은 보존하고 canonical 중첩 필드만 실제로 제거된다", async () => {
    const application = createPaymentConfigurationRuntimeApplication(new FirebasePaymentConfigurationAtomicStore(database));
    const command = (id: string) => ({
      actor: { householdId, memberId: "member" }, commandId: id, idempotencyKey: id,
      commandName: "payment-configuration.mapping-regression.v1", payloadFingerprint: id,
      occurredAt: "2026-09-17T00:00:00.000Z",
    });
    const created = await application.createMerchantRule({ ...command("create"), rule: {
      merchantKeyword: "CAFE", matchType: "exact", mapping: { merchant: "카페", memo: "식비" },
    } });
    expect(created.kind).toBe("success");
    if (created.kind !== "success") throw new Error("Rule creation failed");
    const ruleId = created.value.ruleId as string;
    const canonical = database.doc(`households/${householdId}/merchantRules/${ruleId}`);
    const legacy = database.doc(`merchant_rules/${ruleId}`);
    const createdAt = (await canonical.get()).get("createdAt");
    await application.updateMerchantRule({ ...command("partial"), ruleId, expectedVersion: 1, changes: { mapping: { merchant: "변경" } } });
    expect((await canonical.get()).get("mapping")).toEqual({ merchant: "변경", memo: "식비" });
    // 다른 치환 하나가 남은 non-empty map에서도 삭제를 검증합니다.
    const result = await application.updateMerchantRule({ ...command("clear"), ruleId, expectedVersion: 2, changes: { mapping: { merchant: "" } } });
    expect(result.kind).toBe("success");
    expect((await canonical.get()).get("mapping")).toEqual({ memo: "식비" });
    expect((await legacy.get()).exists).toBe(false);
    expect((await canonical.get()).get("createdAt")).toEqual(createdAt);
  });

  it.each([
    { source: "canonical", field: "category" },
    { source: "canonical", field: "categoryId" },
  ])("[MER-006] $source 최상위 $field 호환값은 삭제 Command와 수집 설정 재조회 뒤 되살아나지 않는다", async ({ source, field }) => {
    const ruleId = `old-${source}-${field}`;
    const canonical = database.doc(`households/${householdId}/merchantRules/${ruleId}`);
    const legacy = database.doc(`merchant_rules/${ruleId}`);
    const seed = { householdId, merchantKeyword: ruleId, exactMatch: true,
      [field]: "food", mapping: { memo: "원래 메모" }, aggregateVersion: 1 };
    await canonical.set(seed);
    // 보존한 legacy 원본에 오래된 치환이 있어도 현재 설정에는 되살리지 않습니다.
    const legacySeed = { ...seed, categoryId: "food" };
    await legacy.set(legacySeed);
    await database.doc(`households/${householdId}/runtimeProjections/payment-capture-configuration-v1`).delete();
    const query = new FirebaseCaptureConfigurationQuery(database);
    const scope = { householdId, actingMemberId: "member" };
    const mapping = async () => {
      const loaded = await query.load(scope);
      expect(loaded.kind).toBe("available");
      if (loaded.kind !== "available") throw new Error("Capture configuration unavailable");
      return loaded.value.merchantRules.find(rule => rule.ruleId === ruleId)?.mapping;
    };
    expect(await mapping()).toEqual({ categoryId: "food", memo: "원래 메모" });
    const command = "payment-configuration.update-merchant-rule.v1";
    const handler = createPaymentConfigurationHouseholdCommandHandlers(database).get(command)!;
    const submit = async (suffix: string, expectedVersion: number, patch: Record<string, string>) => {
      const commandId = `${ruleId}-${suffix}`;
      return handler.execute({ principalUid: "uid", requestedAt: "2026-09-17T00:00:00.000Z",
        actor: { principalUid: "uid", householdId, actingMemberId: "member", capabilities: ["household.read", "household.write"] },
        envelope: { contractVersion: "household-command.v1", command, commandId, idempotencyKey: commandId, householdId,
          payload: { ruleId, expectedVersion, changes: { mapping: patch } } },
      });
    };
    await submit("clear-category", 1, { categoryId: "" });
    expect(await mapping()).toEqual({ memo: "원래 메모" });
    const stored = (await canonical.get()).data();
    expect(stored).not.toHaveProperty("category");
    expect(stored).not.toHaveProperty("categoryId");
    expect(stored?.mapping).toEqual({ memo: "원래 메모" });
    expect((await legacy.get()).data()).toEqual(legacySeed);
    // 다시 수정해도 AtomicStore의 호환 read가 삭제한 category를 되돌리지 않습니다.
    await submit("edit-memo", 2, { memo: "새 메모" });
    expect(await mapping()).toEqual({ memo: "새 메모" });
  });

  it("[MER-006] category를 수정하지 않은 명령은 과거 최상위 categoryId를 canonical mapping으로 보존한다", async () => {
    const ruleId = "old-category-id-preserved";
    const canonical = database.doc(`households/${householdId}/merchantRules/${ruleId}`);
    await canonical.set({ householdId, merchantKeyword: ruleId, exactMatch: true,
      categoryId: "food", mapping: { memo: "원래 메모" }, aggregateVersion: 1 });
    const application = createPaymentConfigurationRuntimeApplication(new FirebasePaymentConfigurationAtomicStore(database));
    const result = await application.updateMerchantRule({
      actor: { householdId, memberId: "member" }, commandId: ruleId, idempotencyKey: ruleId,
      commandName: "payment-configuration.update-merchant-rule.v1", payloadFingerprint: ruleId,
      occurredAt: "2026-09-17T00:00:00.000Z", ruleId, expectedVersion: 1,
      changes: { mapping: { memo: "새 메모" } },
    });
    expect(result.kind).toBe("success");
    const stored = (await canonical.get()).data();
    expect(stored).not.toHaveProperty("categoryId");
    expect(stored?.mapping).toEqual({ categoryId: "food", memo: "새 메모" });
  });
});

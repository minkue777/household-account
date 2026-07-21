import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { FirebasePaymentConfigurationAtomicStore } from "../../../src/adapters/firebase/payment-configuration/firebasePaymentConfigurationAtomicStore";
import { createPaymentConfigurationRuntimeApplication } from "../../../src/contexts/payment-capture/configuration/application/paymentConfigurationRuntimeApplication";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

function command(
  sequence: number,
  commandName: string,
  payloadFingerprint = `payload-${sequence}`,
) {
  return {
    actor: { householdId: "house-1", memberId: "member-1" },
    commandId: `command-${sequence}`,
    idempotencyKey: `idempotency-${sequence}`,
    commandName,
    payloadFingerprint,
    occurredAt: `2026-07-21T00:${String(sequence).padStart(2, "0")}:00.000Z`,
  };
}

describe("Firebase payment configuration atomic adapter", () => {
  it("현재 Web payload를 canonical/legacy에 함께 쓰고 rule claim·version·멱등성을 보장한다", async () => {
    const memory = new InMemoryFirestore();
    memory.seed("households/house-1/members/member-1", {
      householdId: "house-1",
      displayName: "민규",
      lifecycleState: "active",
    });
    const application = createPaymentConfigurationRuntimeApplication(
      new FirebasePaymentConfigurationAtomicStore(
        memory as unknown as firestore.Firestore,
      ),
    );
    const createInput = {
      ...command(1, "payment-configuration.create-merchant-rule.v1"),
      rule: {
        merchantKeyword: " 스타벅스 , 스타벅스리저브 ",
        matchType: "contains",
        mapping: { merchant: "스타벅스", category: "food" },
      },
    };

    const first = await application.createMerchantRule(createInput);
    const replay = await application.createMerchantRule(createInput);

    expect(first).toEqual(replay);
    expect(first.kind).toBe("success");
    if (first.kind !== "success") return;
    const ruleId = first.value.ruleId as string;
    expect(memory.document(`households/house-1/merchantRules/${ruleId}`)).toMatchObject({
      householdId: "house-1",
      merchantKeyword: "스타벅스 , 스타벅스리저브",
      normalizedKeywords: ["스타벅스", "스타벅스리저브"],
      matchType: "contains",
      priority: 10,
      mapping: { merchant: "스타벅스", categoryId: "food" },
      aggregateVersion: 1,
      schemaVersion: 2,
    });
    expect(memory.document(`merchant_rules/${ruleId}`)).toMatchObject({
      householdId: "house-1",
      mapping: { merchant: "스타벅스", category: "food" },
      priority: 10,
    });
    expect(memory.paths("households/house-1/merchantRuleClaims/")).toHaveLength(1);
    expect(memory.paths("commandReceipts/payment-configuration/receipts/")).toHaveLength(1);

    const duplicate = await application.createMerchantRule({
      ...command(2, "payment-configuration.create-merchant-rule.v1"),
      rule: {
        merchantKeyword: "다른 키워드",
        matchType: "contains",
        priority: 10,
        mapping: { category: "food" },
      },
    });
    expect(duplicate).toEqual({
      kind: "rejected",
      code: "MERCHANT_RULE_PRIORITY_CONFLICT",
    });
    expect(memory.paths("households/house-1/merchantRules/")).toHaveLength(1);
  });

  it("카드 owner를 Actor로 고정하고 claim·순서·퇴역과 legacy 삭제를 한 transaction으로 반영한다", async () => {
    const memory = new InMemoryFirestore();
    memory.seed("households/house-1/members/member-1", {
      householdId: "house-1",
      displayName: "민규",
    });
    const application = createPaymentConfigurationRuntimeApplication(
      new FirebasePaymentConfigurationAtomicStore(
        memory as unknown as firestore.Firestore,
      ),
    );

    const first = await application.registerCard({
      ...command(10, "payment-configuration.register-card.v1"),
      card: { cardLabel: "국민", cardLastFour: "1234" },
    });
    const second = await application.registerCard({
      ...command(11, "payment-configuration.register-card.v1"),
      card: { cardLabel: "삼성", cardLastFour: "5678" },
    });
    expect(first.kind).toBe("success");
    expect(second.kind).toBe("success");
    if (first.kind !== "success" || second.kind !== "success") return;
    const firstId = first.value.cardId as string;
    const secondId = second.value.cardId as string;

    expect(memory.document(`households/house-1/registeredCards/${firstId}`)).toMatchObject({
      ownerMemberId: "member-1",
      cardCompanyCode: "국민",
      lastFour: "1234",
      lifecycle: "active",
      aggregateVersion: 1,
    });
    expect(memory.document(`registered_cards/${firstId}`)).toMatchObject({
      owner: "민규",
      ownerMemberId: "member-1",
      cardLabel: "국민",
      cardLastFour: "1234",
    });

    expect(
      await application.registerCard({
        ...command(12, "payment-configuration.register-card.v1"),
        card: { cardLabel: "국민", cardLastFour: "1234" },
      }),
    ).toEqual({ kind: "rejected", code: "DUPLICATE_CARD" });

    expect(
      await application.reorderCards({
        ...command(13, "payment-configuration.reorder-cards.v1"),
        cardIds: [secondId, firstId],
      }),
    ).toEqual({ kind: "success", value: {} });
    expect(memory.document(`registered_cards/${secondId}`)).toMatchObject({
      orderIndex: 0,
    });
    expect(memory.document(`registered_cards/${firstId}`)).toMatchObject({
      orderIndex: 1,
    });

    expect(
      await application.deleteCard({
        ...command(14, "payment-configuration.delete-card.v1"),
        cardId: firstId,
      }),
    ).toEqual({ kind: "success", value: {} });
    expect(memory.document(`households/house-1/registeredCards/${firstId}`)).toMatchObject({
      lifecycle: "retired",
      aggregateVersion: 2,
    });
    expect(memory.has(`registered_cards/${firstId}`)).toBe(false);
    expect(memory.paths("households/house-1/registeredCardClaims/")).toHaveLength(1);
  });
});

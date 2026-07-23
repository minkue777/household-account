import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { FirebasePaymentConfigurationAtomicStore } from "../../../src/adapters/firebase/payment-configuration/firebasePaymentConfigurationAtomicStore";
import { createPaymentConfigurationRuntimeApplication } from "../../../src/contexts/payment-capture/configuration/application/paymentConfigurationRuntimeApplication";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

const projectionPath =
  "households/house-1/runtimeProjections/payment-capture-configuration-v1";

function command(sequence: number, commandName: string) {
  return {
    actor: { householdId: "house-1", memberId: "member-1" },
    commandId: `command-${sequence}`,
    idempotencyKey: `idempotency-${sequence}`,
    commandName,
    payloadFingerprint: `payload-${sequence}`,
    occurredAt: `2026-07-23T00:0${sequence}:00.000Z`,
  };
}

function subject(memory: InMemoryFirestore) {
  memory.seed("households/house-1/members/member-1", {
    displayName: "민규",
  });
  memory.seed(projectionPath, {
    householdId: "house-1",
    schemaVersion: 1,
  });
  return createPaymentConfigurationRuntimeApplication(
    new FirebasePaymentConfigurationAtomicStore(
      memory as unknown as firestore.Firestore,
    ),
  );
}

describe("Firebase payment configuration capture projection invalidation", () => {
  it("카드를 등록하는 동일 트랜잭션에서 수집 설정 projection을 무효화한다", async () => {
    const memory = new InMemoryFirestore();
    const application = subject(memory);

    const result = await application.registerCard({
      ...command(1, "payment-configuration.register-card.v1"),
      card: { cardLabel: "국민", cardLastFour: "0027" },
    });

    expect(result.kind).toBe("success");
    expect(memory.has(projectionPath)).toBe(false);
  });

  it("가맹점 규칙을 등록하는 동일 트랜잭션에서 수집 설정 projection을 무효화한다", async () => {
    const memory = new InMemoryFirestore();
    const application = subject(memory);

    const result = await application.createMerchantRule({
      ...command(2, "payment-configuration.create-merchant-rule.v1"),
      rule: {
        merchantKeyword: "스타벅스",
        matchType: "exact",
        mapping: { merchant: "스타벅스", category: "food" },
      },
    });

    expect(result.kind).toBe("success");
    expect(memory.has(projectionPath)).toBe(false);
  });
});

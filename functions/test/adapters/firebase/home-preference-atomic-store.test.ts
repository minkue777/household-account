import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { FirebaseHomePreferenceAtomicStore } from "../../../src/adapters/firebase/home-preferences/firebaseHomePreferenceAtomicStore";
import { createHomePreferenceRuntimeApplication } from "../../../src/platform/home-preferences/application/homePreferenceRuntimeApplication";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

function command(sequence: number, commandName: string) {
  return {
    actor: { householdId: "house-1", memberId: "member-1" },
    commandId: `home-command-${sequence}`,
    idempotencyKey: `home-idempotency-${sequence}`,
    commandName,
    payloadFingerprint: `home-payload-${sequence}`,
    occurredAt: `2026-07-21T01:${String(sequence).padStart(2, "0")}:00.000Z`,
  };
}

describe("Firebase home preference atomic adapter", () => {
  it("첫 지역화폐는 자동 선택하고 이후 유형 추가에도 유지하며 canonical·legacy·Outbox를 원자 갱신한다", async () => {
    const memory = new InMemoryFirestore();
    memory.seed("households/house-1", {
      lifecycleState: "active",
      homeSummaryConfig: {
        leftCard: "localCurrencyBalance",
        rightCard: "monthlyRemainingBudget",
      },
    });
    memory.seed("balances/gyeonggi", {
      householdId: "house-1",
      currencyType: "gyeonggi",
      balance: 10000,
    });
    const application = createHomePreferenceRuntimeApplication(
      new FirebaseHomePreferenceAtomicStore(
        memory as unknown as firestore.Firestore,
      ),
    );

    const firstInput = {
      ...command(1, "home.update-summary-preferences.v1"),
      leftCard: "monthlySpent",
      rightCard: "yearlySpent",
    };
    expect(await application.updateSummary(firstInput)).toEqual({
      kind: "success",
      value: {},
    });
    expect(await application.updateSummary(firstInput)).toEqual({
      kind: "success",
      value: {},
    });
    expect(memory.document("households/house-1/homePreferences/home")).toMatchObject({
      left: "MONTHLY_EXPENSE",
      right: "YEARLY_EXPENSE",
      selectedLocalCurrencyType: "gyeonggi",
      aggregateVersion: 1,
      schemaVersion: 2,
    });
    expect(memory.document("households/house-1")).toMatchObject({
      homeSummaryConfig: {
        leftCard: "monthlySpent",
        rightCard: "yearlySpent",
      },
      selectedLocalCurrencyType: "gyeonggi",
      homeSummaryConfigVersion: 1,
    });
    expect(memory.paths("outboxEvents/")).toHaveLength(1);
    expect(memory.paths("commandReceipts/home-preferences/receipts/")).toHaveLength(1);

    memory.seed("balances/daejeon", {
      householdId: "house-1",
      currencyType: "daejeon",
      balance: 20000,
    });
    expect(
      await application.updateSummary({
        ...command(2, "home.update-summary-preferences.v1"),
        leftCard: "localCurrencyBalance",
        rightCard: "monthlyRemainingBudget",
      }),
    ).toEqual({ kind: "success", value: {} });
    expect(memory.document("households/house-1/homePreferences/home")).toMatchObject({
      selectedLocalCurrencyType: "gyeonggi",
      aggregateVersion: 2,
    });

    expect(
      await application.selectLocalCurrency({
        ...command(3, "home.select-local-currency.v1"),
        localCurrencyTypeId: "daejeon",
      }),
    ).toEqual({ kind: "success", value: {} });
    expect(memory.document("households/house-1/homePreferences/home")).toMatchObject({
      selectedLocalCurrencyType: "daejeon",
      aggregateVersion: 3,
    });
    expect(memory.paths("outboxEvents/")).toHaveLength(3);

    expect(
      await application.selectLocalCurrency({
        ...command(4, "home.select-local-currency.v1"),
        localCurrencyTypeId: "sejong",
      }),
    ).toEqual({
      kind: "rejected",
      code: "LOCAL_CURRENCY_TYPE_NOT_AVAILABLE",
    });
    expect(memory.document("households/house-1/homePreferences/home")).toMatchObject({
      selectedLocalCurrencyType: "daejeon",
      aggregateVersion: 3,
    });
  });
});

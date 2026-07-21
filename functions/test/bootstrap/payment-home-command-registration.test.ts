import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { createHomeHouseholdCommandHandlers } from "../../src/bootstrap/commands/homeHouseholdCommandHandlers";
import { createPaymentConfigurationHouseholdCommandHandlers } from "../../src/bootstrap/commands/paymentConfigurationHouseholdCommandHandlers";

describe("Payment Configuration / Home household command 등록", () => {
  it("공개 manifest의 9개 command를 placeholder가 아닌 handler로 제공한다", () => {
    const database = {} as firestore.Firestore;
    expect([
      ...createPaymentConfigurationHouseholdCommandHandlers(database).keys(),
      ...createHomeHouseholdCommandHandlers(database).keys(),
    ]).toEqual([
      "payment-configuration.create-merchant-rule.v1",
      "payment-configuration.update-merchant-rule.v1",
      "payment-configuration.delete-merchant-rule.v1",
      "payment-configuration.register-card.v1",
      "payment-configuration.update-card.v1",
      "payment-configuration.delete-card.v1",
      "payment-configuration.reorder-cards.v1",
      "home.update-summary-preferences.v1",
      "home.select-local-currency.v1",
    ]);
  });
});

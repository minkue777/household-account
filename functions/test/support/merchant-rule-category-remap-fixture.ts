import { createMerchantRuleCategoryRemapApplication } from "../../src/contexts/payment-capture/configuration/application/merchantRuleCategoryRemapApplication";
import type { RemappableMerchantRule } from "../../src/contexts/payment-capture/configuration/application/ports/in/merchantRuleCategoryRemapInputPort";

export function createMerchantRuleCategoryRemapFixture(fixture: {
  readonly rules: readonly RemappableMerchantRule[];
}) {
  return createMerchantRuleCategoryRemapApplication(fixture.rules);
}

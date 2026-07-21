import { createMerchantRulePersistenceApplication } from "../../src/contexts/payment-capture/configuration/application/merchantRulePersistenceApplication";
import type { PersistedMerchantRuleView } from "../../src/contexts/payment-capture/configuration/application/ports/in/merchantRulePersistenceInputPort";

export function createMerchantRulePersistenceFixture(fixture?: {
  readonly rules?: readonly PersistedMerchantRuleView[];
}) {
  return createMerchantRulePersistenceApplication(fixture);
}

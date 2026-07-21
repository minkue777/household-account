import { readLegacyMerchantRule } from "../../src/contexts/payment-capture/configuration/adapters/persistence/merchantRuleLegacyAdapter";

export function createMerchantRuleLegacyAdapterFixture() {
  return { read: readLegacyMerchantRule };
}

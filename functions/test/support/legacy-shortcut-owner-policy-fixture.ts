import { resolveLegacyShortcutOwner } from "../../src/contexts/payment-capture/shortcut-ingestion/domain/policies/resolveLegacyShortcutOwner";

export function createLegacyShortcutOwnerPolicyFixture() {
  return { resolve: resolveLegacyShortcutOwner };
}

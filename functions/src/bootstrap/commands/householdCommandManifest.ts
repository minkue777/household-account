import type { HouseholdCommandHandler } from "./householdCommand";

/**
 * Runtime copy of contracts/fixtures/system/household-command-manifest.v1.json.
 * A contract test compares this list with the public manifest so drift fails CI.
 */
export const HOUSEHOLD_COMMAND_NAMES = Object.freeze([
  "access.resolve-signed-in-user.v1",
  "access.claim-legacy-membership.v1",
  "access.create-household-with-self.v1",
  "access.join-household-as-self.v1",
  "access.create-invitation.v1",
  "access.rename-self.v1",
  "access.create-asset-owner-profile.v1",
  "access.rename-asset-owner-profile.v1",
  "access.archive-asset-owner-profile.v1",
  "access.request-household-deletion.v1",
  "ledger.record-manual-transaction.v1",
  "ledger.update-transaction.v1",
  "ledger.delete-transaction.v1",
  "ledger.change-transaction-category.v1",
  "ledger.split-transaction.v1",
  "ledger.split-existing-transaction-monthly.v1",
  "ledger.record-manual-monthly-split.v1",
  "ledger.merge-transactions.v1",
  "ledger.unmerge-transaction.v1",
  "ledger.cancel-monthly-split.v1",
  "ledger.reconfigure-monthly-split.v1",
  "ledger.request-notification.v1",
  "category.create.v1",
  "category.update.v1",
  "category.archive.v1",
  "category.set-budget.v1",
  "category.reorder.v1",
  "category.set-default.v1",
  "recurring.create-plan.v1",
  "recurring.update-plan.v1",
  "recurring.delete-plan.v1",
  "payment-configuration.create-merchant-rule.v1",
  "payment-configuration.update-merchant-rule.v1",
  "payment-configuration.delete-merchant-rule.v1",
  "payment-configuration.register-card.v1",
  "payment-configuration.update-card.v1",
  "payment-configuration.delete-card.v1",
  "payment-configuration.reorder-cards.v1",
  "shortcut.issue-credential.v1",
  "shortcut.reissue-credential.v1",
  "shortcut.revoke-credential.v1",
  "portfolio.create-asset.v1",
  "portfolio.update-asset.v1",
  "portfolio.reorder-assets.v1",
  "portfolio.delete-asset.v1",
  "portfolio.add-position.v1",
  "portfolio.update-position.v1",
  "portfolio.delete-position.v1",
  "portfolio.refresh-market-values.v1",
  "notifications.register-endpoint.v1",
  "notifications.remove-endpoint.v1",
  "home.update-summary-preferences.v1",
  "home.select-local-currency.v1",
] as const);

export type HouseholdCommandName = (typeof HOUSEHOLD_COMMAND_NAMES)[number];

export function createManifestBackedHouseholdCommandRegistry(
  implemented: Iterable<readonly [string, HouseholdCommandHandler]>,
): ReadonlyMap<string, HouseholdCommandHandler> {
  const commandNames = new Set<string>(HOUSEHOLD_COMMAND_NAMES);
  const registry = new Map<string, HouseholdCommandHandler>();

  for (const [name, handler] of implemented) {
    if (!commandNames.has(name)) {
      throw new Error(`Command handler is missing from the public manifest: ${name}`);
    }
    if (registry.has(name)) {
      throw new Error(`Command handler is registered more than once: ${name}`);
    }
    registry.set(name, handler);
  }

  const missing = HOUSEHOLD_COMMAND_NAMES.filter((name) => !registry.has(name));
  if (missing.length > 0) {
    throw new Error(`Public command handlers are missing: ${missing.join(", ")}`);
  }

  return registry;
}

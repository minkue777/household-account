import type * as firestore from "firebase-admin/firestore";
import {
  resolveFirebaseSignedInUser,
  SignedInUserResolutionError,
} from "../adapters/firebase/access/firebaseSignedInUserResolver";
import { createLedgerHouseholdCommandHandlers } from "./commands/ledgerHouseholdCommandHandlers";
import { createAccessHouseholdCommandHandlers } from "./commands/accessHouseholdCommandHandlers";
import { createManifestBackedHouseholdCommandRegistry } from "./commands/householdCommandManifest";
import { createNotificationHouseholdCommandHandlers } from "./commands/notificationHouseholdCommandHandlers";
import { createCategoryHouseholdCommandHandlers } from "./commands/categoryHouseholdCommandHandlers";
import { createRecurringHouseholdCommandHandlers } from "./commands/recurringHouseholdCommandHandlers";
import { createPaymentConfigurationHouseholdCommandHandlers } from "./commands/paymentConfigurationHouseholdCommandHandlers";
import { createHomeHouseholdCommandHandlers } from "./commands/homeHouseholdCommandHandlers";
import { createPortfolioHouseholdCommandHandlers } from "./commands/portfolioHouseholdCommandHandlers";
import { createMemberAccessHouseholdCommandHandlers } from "./commands/memberAccessHouseholdCommandHandlers";
import {
  createFirebaseShortcutCredentialLifecycle,
  createShortcutCredentialHouseholdCommandHandlers,
} from "./commands/shortcutCredentialHouseholdCommandHandlers";
import { HouseholdCommandRejection } from "./commands/householdCommand";

export function createFirebaseHouseholdCommandRegistry(db: firestore.Firestore) {
  return createManifestBackedHouseholdCommandRegistry([
    [
      "access.resolve-signed-in-user.v1",
      {
        access: "signed-in-user",
        idempotencyBoundary: "read-only",
        async execute({ principalUid }) {
          try {
            return await resolveFirebaseSignedInUser(db, principalUid);
          } catch (error) {
            if (error instanceof SignedInUserResolutionError) {
              throw new HouseholdCommandRejection(error.code);
            }
            throw error;
          }
        },
      },
    ],
    ...createMemberAccessHouseholdCommandHandlers(db),
    ...createAccessHouseholdCommandHandlers(db),
    ...createLedgerHouseholdCommandHandlers(db),
    ...createCategoryHouseholdCommandHandlers(db),
    ...createRecurringHouseholdCommandHandlers(db),
    ...createPaymentConfigurationHouseholdCommandHandlers(db),
    ...createShortcutCredentialHouseholdCommandHandlers(createFirebaseShortcutCredentialLifecycle(db)),
    ...createHomeHouseholdCommandHandlers(db),
    ...createPortfolioHouseholdCommandHandlers(db),
    ...createNotificationHouseholdCommandHandlers(db),
  ]);
}

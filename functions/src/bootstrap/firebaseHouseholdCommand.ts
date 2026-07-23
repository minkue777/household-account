import * as functions from "firebase-functions/v1";

import {
  FirebaseHouseholdCommandMembershipAdapter,
  FirebaseHouseholdCommandReceiptAdapter,
  Sha256HouseholdCommandHashAdapter,
} from "../adapters/firebase/commands/firebaseHouseholdCommandInfrastructure";
import {
  resolveFirebaseSignedInUser,
  SignedInUserResolutionError,
} from "../adapters/firebase/access/firebaseSignedInUserResolver";
import { db, REGION } from "../config";
import {
  HouseholdCommandRejection,
  type HouseholdCommandHandler,
  type HouseholdCommandResult,
} from "./commands/householdCommand";
import { createHouseholdCommandRouter } from "./commands/householdCommandRouter";
import { createLedgerHouseholdCommandHandlers } from "./commands/ledgerHouseholdCommandHandlers";
import { createAccessHouseholdCommandHandlers } from "./commands/accessHouseholdCommandHandlers";
import { createManifestBackedHouseholdCommandRegistry } from "./commands/householdCommandManifest";
import { createNotificationHouseholdCommandHandlers } from "./commands/notificationHouseholdCommandHandlers";
import { createCategoryHouseholdCommandHandlers } from "./commands/categoryHouseholdCommandHandlers";
import { createRecurringHouseholdCommandHandlers } from "./commands/recurringHouseholdCommandHandlers";
import { createPaymentConfigurationHouseholdCommandHandlers } from "./commands/paymentConfigurationHouseholdCommandHandlers";
import { createHomeHouseholdCommandHandlers } from "./commands/homeHouseholdCommandHandlers";
import { createPortfolioHouseholdCommandHandlers } from "./commands/portfolioHouseholdCommandHandlers";
import {
  createFirebaseShortcutCredentialLifecycle,
  createShortcutCredentialHouseholdCommandHandlers,
} from "./commands/shortcutCredentialHouseholdCommandHandlers";
import { verifiedSystemAdministrator } from "./verifiedSystemAdministrator";

export interface HouseholdCommandWireResponse {
  readonly contractVersion: "household-command-response.v1";
  readonly commandId: string;
  readonly result:
    | { readonly kind: "succeeded"; readonly value: unknown }
    | { readonly kind: "already-processed"; readonly value: unknown }
    | {
        readonly kind: "rejected";
        readonly error: { readonly code: string; readonly retryable: boolean };
      };
}

function requestCommandId(request: unknown): string {
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    return "invalid-command";
  }
  const commandId = (request as Record<string, unknown>).commandId;
  return typeof commandId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(commandId)
    ? commandId
    : "invalid-command";
}

export function toHouseholdCommandWireResponse(
  request: unknown,
  result: HouseholdCommandResult,
): HouseholdCommandWireResponse {
  const commandId = result.commandId ?? requestCommandId(request);
  if (result.kind === "success") {
    return {
      contractVersion: "household-command-response.v1",
      commandId,
      result: {
        kind: result.replayed === true ? "already-processed" : "succeeded",
        value: result.data,
      },
    };
  }
  const domainCode = result.details?.domainCode;
  return {
    contractVersion: "household-command-response.v1",
    commandId,
    result: {
      kind: "rejected",
      error: {
        code:
          typeof domainCode === "string" && /^[A-Z][A-Z0-9_]{1,79}$/u.test(domainCode)
            ? domainCode
            : result.code,
        retryable: result.retryable,
      },
    },
  };
}

function accessReadHandlers(): ReadonlyMap<string, HouseholdCommandHandler> {
  return new Map([
    [
      "access.resolve-signed-in-user.v1",
      {
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
  ]);
}

const handlers = createManifestBackedHouseholdCommandRegistry([
  ...accessReadHandlers(),
  ...createAccessHouseholdCommandHandlers(db),
  ...createLedgerHouseholdCommandHandlers(db),
  ...createCategoryHouseholdCommandHandlers(db),
  ...createRecurringHouseholdCommandHandlers(db),
  ...createPaymentConfigurationHouseholdCommandHandlers(db),
  ...createShortcutCredentialHouseholdCommandHandlers(
    createFirebaseShortcutCredentialLifecycle(db),
  ),
  ...createHomeHouseholdCommandHandlers(db),
  ...createPortfolioHouseholdCommandHandlers(db),
  ...createNotificationHouseholdCommandHandlers(db),
]);

const router = createHouseholdCommandRouter({
  handlers,
  memberships: new FirebaseHouseholdCommandMembershipAdapter(db),
  receipts: new FirebaseHouseholdCommandReceiptAdapter(db),
  hashes: new Sha256HouseholdCommandHashAdapter(),
});

export const executeHouseholdCommand = functions
  .region(REGION)
  .runWith({
    enforceAppCheck: true,
    minInstances: 1,
    secrets: ["SHORTCUT_CREDENTIAL_PEPPER"],
  })
  .https.onCall(async (data, context): Promise<HouseholdCommandWireResponse> => {
    const result = await router.execute({
      principalUid: context.auth?.uid,
      administrator: verifiedSystemAdministrator(
        context.auth?.uid,
        context.auth?.token,
      ),
      request: data,
      requestedAt: new Date().toISOString(),
    });
    return toHouseholdCommandWireResponse(data, result);
  });

import * as functions from "firebase-functions/v1";

import {
  FirebaseHouseholdCommandMembershipAdapter,
  FirebaseHouseholdCommandReceiptAdapter,
  Sha256HouseholdCommandHashAdapter,
} from "../adapters/firebase/commands/firebaseHouseholdCommandInfrastructure";
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
          const snapshot = await db
            .collection("users")
            .doc(principalUid)
            .collection("householdMembershipViews")
            .where("lifecycleState", "==", "active")
            .limit(2)
            .get();
          if (snapshot.size !== 1) {
            return { kind: "first-visit-required", choices: ["create", "join"] };
          }
          const membership = snapshot.docs[0].data();
          const householdId =
            typeof membership.householdId === "string"
              ? membership.householdId
              : snapshot.docs[0].id;
          if (typeof membership.memberId !== "string") {
            return { kind: "first-visit-required", choices: ["create", "join"] };
          }
          const [canonicalMembership, member, household] = await Promise.all([
            db
              .collection("households")
              .doc(householdId)
              .collection("memberships")
              .doc(principalUid)
              .get(),
            db
              .collection("households")
              .doc(householdId)
              .collection("members")
              .doc(membership.memberId)
              .get(),
            db.collection("households").doc(householdId).get(),
          ]);
          if (
            !household.exists ||
            household.data()?.lifecycleState === "deleted" ||
            household.data()?.deletedAt !== undefined
          ) {
            throw new HouseholdCommandRejection("HOUSEHOLD_NOT_ACTIVE");
          }
          const membershipData = canonicalMembership.data() ?? membership;
          const memberData = member.data();
          const displayName =
            typeof memberData?.displayName === "string"
              ? memberData.displayName
              : typeof membershipData.displayName === "string"
                ? membershipData.displayName
                : undefined;
          const aggregateVersion =
            typeof memberData?.aggregateVersion === "number"
              ? memberData.aggregateVersion
              : typeof membershipData.aggregateVersion === "number"
                ? membershipData.aggregateVersion
                : undefined;
          if (
            displayName === undefined ||
            displayName.trim() === "" ||
            aggregateVersion === undefined
          ) {
            throw new HouseholdCommandRejection(
              "MEMBER_PROFILE_INVARIANT_BROKEN",
            );
          }
          return {
            kind: "membership-found",
            membership: {
              householdId,
              memberId: membership.memberId,
              displayName,
              aggregateVersion,
              status: "active",
              capabilities: Array.isArray(membershipData.capabilities)
                ? membershipData.capabilities
                : [],
            },
          };
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

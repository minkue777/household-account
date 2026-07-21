import type * as firestore from "firebase-admin/firestore";

import {
  FirebaseShortcutCredentialAccessAdapter,
  FirebaseShortcutCredentialStoreAdapter,
  HmacShortcutCredentialSecretAdapter,
} from "../../adapters/firebase/payment-capture/firebaseShortcutCredentialInfrastructure";
import { createShortcutCredentialLifecycleApplication } from "../../contexts/payment-capture/shortcut-ingestion/application/shortcutCredentialLifecycleApplication";
import type { ShortcutCredentialLifecycleInputPort } from "../../contexts/payment-capture/shortcut-ingestion/application/ports/in/shortcutCredentialLifecycleInputPort";
import {
  HouseholdCommandRejection,
  type HouseholdCommandExecutionContext,
  type HouseholdCommandHandler,
  withHouseholdCommandReceiptValue,
} from "./householdCommand";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index])
  );
}

function stableId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value)
  );
}

function session(context: HouseholdCommandExecutionContext) {
  if (context.actor === undefined) {
    throw new HouseholdCommandRejection("HOUSEHOLD_FORBIDDEN");
  }
  return {
    principalUid: context.principalUid,
    householdId: context.actor.householdId,
    memberId: context.actor.actingMemberId,
    membershipState: "active" as const,
    householdState: "active" as const,
  };
}

function mapIssueResult(
  result: Awaited<ReturnType<ShortcutCredentialLifecycleInputPort["issue"]>>,
) {
  if (result.kind === "forbidden") {
    throw new HouseholdCommandRejection(result.code);
  }
  if (result.kind === "retryableFailure") {
    throw new HouseholdCommandRejection(result.code, true);
  }
  if (result.kind === "alreadyIssued") {
    return {
      kind: "alreadyIssued" as const,
      credentialId: result.credentialId,
      credentialVersion: result.credentialVersion,
    };
  }

  const response = {
    kind: "issued" as const,
    credentialId: result.credentialId,
    credentialVersion: result.credentialVersion,
    rawCredential: result.rawCredential,
    installUrl: result.installUrl,
    issuedAt: result.issuedAt,
  };
  return withHouseholdCommandReceiptValue(response, {
    kind: "alreadyIssued" as const,
    credentialId: result.credentialId,
    credentialVersion: result.credentialVersion,
  });
}

export function createFirebaseShortcutCredentialLifecycle(
  database: firestore.Firestore,
): ShortcutCredentialLifecycleInputPort {
  return createShortcutCredentialLifecycleApplication({
    access: new FirebaseShortcutCredentialAccessAdapter(database),
    secrets: new HmacShortcutCredentialSecretAdapter({
      pepper: () => process.env.SHORTCUT_CREDENTIAL_PEPPER,
      keyVersion: () => process.env.SHORTCUT_CREDENTIAL_KEY_VERSION,
      installUrl: () => process.env.SHORTCUT_INSTALL_URL,
    }),
    store: new FirebaseShortcutCredentialStoreAdapter(database),
  });
}

export function createShortcutCredentialHouseholdCommandHandlers(
  lifecycle: ShortcutCredentialLifecycleInputPort,
): ReadonlyMap<string, HouseholdCommandHandler> {
  return new Map([
    [
      "shortcut.issue-credential.v1",
      {
        async execute(context) {
          if (!exactKeys(context.envelope.payload, [])) {
            throw new HouseholdCommandRejection("INVALID_PAYLOAD");
          }
          try {
            return mapIssueResult(
              await lifecycle.issue({
                session: session(context),
                requestedAt: context.requestedAt,
                idempotencyKey: context.envelope.idempotencyKey,
                issuanceMode: "if-absent",
              }),
            );
          } catch (error) {
            if (error instanceof HouseholdCommandRejection) throw error;
            throw new HouseholdCommandRejection(
              error instanceof Error &&
                error.message === "SHORTCUT_INSTALL_URL_NOT_CONFIGURED"
                ? error.message
                : "SHORTCUT_CREDENTIAL_UNAVAILABLE",
              true,
            );
          }
        },
      },
    ],
    [
      "shortcut.reissue-credential.v1",
      {
        async execute(context) {
          const payload = context.envelope.payload;
          if (
            !isRecord(payload) ||
            !exactKeys(payload, ["currentCredentialId", "expectedVersion"]) ||
            !stableId(payload.currentCredentialId) ||
            !Number.isSafeInteger(payload.expectedVersion) ||
            (payload.expectedVersion as number) < 1
          ) {
            throw new HouseholdCommandRejection("INVALID_PAYLOAD");
          }
          try {
            return mapIssueResult(
              await lifecycle.reissue({
                session: session(context),
                currentCredentialId: payload.currentCredentialId,
                expectedVersion: payload.expectedVersion as number,
                requestedAt: context.requestedAt,
                idempotencyKey: context.envelope.idempotencyKey,
              }),
            );
          } catch (error) {
            if (error instanceof HouseholdCommandRejection) throw error;
            throw new HouseholdCommandRejection(
              "SHORTCUT_CREDENTIAL_UNAVAILABLE",
              true,
            );
          }
        },
      },
    ],
    [
      "shortcut.revoke-credential.v1",
      {
        async execute(context) {
          const payload = context.envelope.payload;
          if (
            !exactKeys(payload, ["credentialId", "expectedVersion"]) ||
            !stableId(payload.credentialId) ||
            !Number.isSafeInteger(payload.expectedVersion) ||
            (payload.expectedVersion as number) < 1
          ) {
            throw new HouseholdCommandRejection("INVALID_PAYLOAD");
          }
          const result = await lifecycle.revoke({
            session: session(context),
            credentialId: payload.credentialId,
            expectedVersion: payload.expectedVersion as number,
            requestedAt: context.requestedAt,
            idempotencyKey: context.envelope.idempotencyKey,
          });
          if (result.kind === "forbidden") {
            throw new HouseholdCommandRejection(result.code);
          }
          if (result.kind === "conflict") {
            throw new HouseholdCommandRejection(result.code);
          }
          return result;
        },
      },
    ],
  ]);
}

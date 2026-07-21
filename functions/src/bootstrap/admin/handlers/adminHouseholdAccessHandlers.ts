import type * as firestore from "firebase-admin/firestore";

import { FirebaseAdminHouseholdStore } from "../../../adapters/firebase/access/firebaseAdminHouseholdStore";
import { FirebaseHouseholdLifecycleUnitOfWork } from "../../../adapters/firebase/access/firebaseHouseholdLifecycleUnitOfWork";
import {
  sha256,
  stableAccessId,
} from "../../../adapters/firebase/access/firebaseAccessPersistence";
import { createAdminHouseholdConsoleApplication } from "../../../contexts/access/admin-household-console/application/adminHouseholdConsoleApplication";
import { createHouseholdLifecycleApplication } from "../../../contexts/access/household-lifecycle/application/householdLifecycleApplication";
import {
  AdminAccessRejection,
  type AdminAccessHandler,
  type AdminAccessOperation,
} from "../adminAccess";
import {
  exactKeys,
  householdConsoleCapabilities,
  householdLifecycleCapabilities,
  reject,
  requiredString,
  requiredVersion,
} from "./adminAccessHandlerSupport";

type HandlerEntry = readonly [AdminAccessOperation, AdminAccessHandler];

function householdConsoleApplication(input: {
  readonly database: firestore.Firestore;
  readonly principalRef: string;
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly requestedAt: string;
  readonly requestId: string;
}) {
  const householdId = stableAccessId(
    "household-admin",
    input.principalRef,
    input.idempotencyKey,
  );
  return createAdminHouseholdConsoleApplication({
    store: new FirebaseAdminHouseholdStore(input.database, {
      principalRef: input.principalRef,
      idempotencyKey: input.idempotencyKey,
      payloadFingerprint: input.payloadFingerprint,
      requestedAt: input.requestedAt,
      commandId: input.requestId,
    }),
    identities: {
      nextHouseholdId: () => householdId,
      nextLegacyShareKey: () => householdId,
    },
    clock: { now: () => input.requestedAt },
  });
}

function householdLifecycleApplication(input: {
  readonly database: firestore.Firestore;
  readonly principalRef: string;
  readonly householdId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly requestId: string;
}) {
  return createHouseholdLifecycleApplication({
    unitOfWork: new FirebaseHouseholdLifecycleUnitOfWork(input.database, {
      householdId: input.householdId,
      principalUid: input.principalRef,
      idempotencyKey: input.idempotencyKey,
      requestedAt: input.requestedAt,
      commandId: input.requestId,
    }),
    clock: { now: () => input.requestedAt },
    identities: {
      nextPurgeProcessId: (key) => stableAccessId("household-purge", key),
    },
    hash: { hashSensitiveReference: sha256 },
  });
}

export function createAdminHouseholdAccessHandlers(
  database: firestore.Firestore,
): readonly HandlerEntry[] {
  return [
    [
      "list-households",
      {
        async execute(context) {
          const payload = context.envelope.payload as Record<string, unknown>;
          if (!exactKeys(payload, ["cursor", "limit"])) {
            throw new AdminAccessRejection("INVALID_PAYLOAD");
          }
          const cursor = payload.cursor;
          const limit = payload.limit ?? 50;
          if (
            (cursor !== undefined && typeof cursor !== "string") ||
            typeof limit !== "number" ||
            !Number.isSafeInteger(limit) ||
            limit < 1 ||
            limit > 100
          ) {
            throw new AdminAccessRejection("INVALID_PAYLOAD");
          }
          const result = await householdConsoleApplication({
            database,
            principalRef: context.administrator.principalRef,
            idempotencyKey: context.envelope.idempotencyKey,
            payloadFingerprint: context.envelope.requestId,
            requestedAt: context.requestedAt,
            requestId: context.envelope.requestId,
          }).listHouseholds(
            {
              principalRef: context.administrator.principalRef,
              capabilities: householdConsoleCapabilities(
                context.administrator.capabilities,
              ),
            },
            {
              ...(typeof cursor === "string" ? { cursor } : {}),
              limit,
            },
          );
          return result.kind === "success"
            ? result.value
            : reject(result, "ADMIN_HOUSEHOLD_LIST_FAILED");
        },
      },
    ],
    [
      "create-household",
      {
        async execute(context) {
          const payload = context.envelope.payload as Record<string, unknown>;
          if (!exactKeys(payload, ["name"])) {
            throw new AdminAccessRejection("INVALID_PAYLOAD");
          }
          const name = requiredString(payload.name, "HOUSEHOLD_NAME_REQUIRED");
          const result = await householdConsoleApplication({
            database,
            principalRef: context.administrator.principalRef,
            idempotencyKey: context.envelope.idempotencyKey,
            payloadFingerprint: sha256(JSON.stringify(["create", name])),
            requestedAt: context.requestedAt,
            requestId: context.envelope.requestId,
          }).createHousehold(
            {
              principalRef: context.administrator.principalRef,
              capabilities: householdConsoleCapabilities(
                context.administrator.capabilities,
              ),
            },
            { name, idempotencyKey: context.envelope.idempotencyKey },
          );
          return result.kind === "success"
            ? result.value
            : reject(result, "ADMIN_HOUSEHOLD_CREATE_FAILED");
        },
      },
    ],
    [
      "get-legacy-share-key",
      {
        async execute(context) {
          const payload = context.envelope.payload as Record<string, unknown>;
          if (!exactKeys(payload, ["householdId"])) {
            throw new AdminAccessRejection("INVALID_PAYLOAD");
          }
          const householdId = requiredString(
            payload.householdId,
            "HOUSEHOLD_ID_REQUIRED",
          );
          const result = await householdConsoleApplication({
            database,
            principalRef: context.administrator.principalRef,
            idempotencyKey: context.envelope.idempotencyKey,
            payloadFingerprint: context.envelope.requestId,
            requestedAt: context.requestedAt,
            requestId: context.envelope.requestId,
          }).readLegacyShareKey(
            {
              principalRef: context.administrator.principalRef,
              capabilities: householdConsoleCapabilities(
                context.administrator.capabilities,
              ),
            },
            householdId,
          );
          return result.kind === "success"
            ? { legacyShareKey: result.value }
            : reject(result, "LEGACY_SHARE_KEY_NOT_FOUND");
        },
      },
    ],
    [
      "delete-household",
      {
        async execute(context) {
          const payload = context.envelope.payload as Record<string, unknown>;
          if (
            !exactKeys(payload, [
              "householdId",
              "confirmed",
              "expectedVersion",
            ])
          ) {
            throw new AdminAccessRejection("INVALID_PAYLOAD");
          }
          const householdId = requiredString(
            payload.householdId,
            "HOUSEHOLD_ID_REQUIRED",
          );
          if (payload.confirmed !== true) {
            throw new AdminAccessRejection("DELETION_CONFIRMATION_REQUIRED");
          }
          const expectedVersion = requiredVersion(payload.expectedVersion);
          const result = await householdConsoleApplication({
            database,
            principalRef: context.administrator.principalRef,
            idempotencyKey: context.envelope.idempotencyKey,
            payloadFingerprint: sha256(
              JSON.stringify(["delete", householdId, expectedVersion]),
            ),
            requestedAt: context.requestedAt,
            requestId: context.envelope.requestId,
          }).deleteHousehold(
            {
              principalRef: context.administrator.principalRef,
              capabilities: householdConsoleCapabilities(
                context.administrator.capabilities,
              ),
            },
            {
              householdId,
              confirmed: true,
              expectedVersion,
              idempotencyKey: context.envelope.idempotencyKey,
            },
          );
          return result.kind === "success"
            ? result.value
            : reject(result, "ADMIN_HOUSEHOLD_DELETE_FAILED");
        },
      },
    ],
    [
      "restore-household",
      {
        async execute(context) {
          const payload = context.envelope.payload as Record<string, unknown>;
          if (!exactKeys(payload, ["householdId", "reason", "expectedVersion"])) {
            throw new AdminAccessRejection("INVALID_PAYLOAD");
          }
          const householdId = requiredString(
            payload.householdId,
            "HOUSEHOLD_ID_REQUIRED",
          );
          const reason = requiredString(payload.reason, "RESTORE_REASON_REQUIRED");
          const expectedVersion = requiredVersion(payload.expectedVersion);
          const result = await householdLifecycleApplication({
            database,
            principalRef: context.administrator.principalRef,
            householdId,
            idempotencyKey: context.envelope.idempotencyKey,
            requestedAt: context.requestedAt,
            requestId: context.envelope.requestId,
          }).restoreDeletedHousehold(
            {
              principalRef: context.administrator.principalRef,
              capabilities: householdLifecycleCapabilities(
                context.administrator.capabilities,
              ),
            },
            {
              householdId,
              reason,
              expectedVersion,
              idempotencyKey: context.envelope.idempotencyKey,
            },
          );
          return result.kind === "success" || result.kind === "already-processed"
            ? result.household
            : reject(result, "ADMIN_HOUSEHOLD_RESTORE_FAILED");
        },
      },
    ],
  ];
}

import type * as firestore from "firebase-admin/firestore";

import { sha256, stableAccessId } from "../../../adapters/firebase/access/firebaseAccessPersistence";
import { FirebaseAssetLifecycleUnitOfWork } from "../../../adapters/firebase/portfolio/firebaseAssetLifecycleUnitOfWork";
import { createAssetRestorationAutomationParticipant } from "../../../contexts/portfolio/automation/application/assetRestorationParticipant";
import { createAssetLifecycleApplication } from "../../../contexts/portfolio/core/application/assetLifecycleApplication";
import {
  AdminAccessRejection,
  type AdminAccessHandler,
  type AdminAccessOperation,
} from "../adminAccess";
import {
  assetRestorationCapabilities,
  exactKeys,
  reject,
  requiredString,
  requiredVersion,
  seoulLocalDate,
} from "./adminAccessHandlerSupport";

type HandlerEntry = readonly [AdminAccessOperation, AdminAccessHandler];

function assetLifecycleApplication(input: {
  readonly database: firestore.Firestore;
  readonly principalRef: string;
  readonly householdId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly requestId: string;
}) {
  const unitOfWork = new FirebaseAssetLifecycleUnitOfWork(input.database, {
    administratorPrincipalRef: input.principalRef,
    householdId: input.householdId,
    idempotencyKey: input.idempotencyKey,
    requestedAt: input.requestedAt,
    commandId: input.requestId,
  });
  return createAssetLifecycleApplication({
    unitOfWork,
    clock: { now: () => input.requestedAt },
    ids: { purgeProcessId: (key) => stableAccessId("asset-purge", key) },
    hash: { hash: sha256 },
    restorationParticipant: createAssetRestorationAutomationParticipant(),
  });
}

export function createAdminAssetAccessHandlers(
  database: firestore.Firestore,
): readonly HandlerEntry[] {
  return [
    [
      "list-deleted-assets",
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
          const application = assetLifecycleApplication({
            database,
            principalRef: context.administrator.principalRef,
            householdId,
            idempotencyKey: context.envelope.idempotencyKey,
            requestedAt: context.requestedAt,
            requestId: context.envelope.requestId,
          });
          const result = await application.listDeletedAssets({
            actorId: context.administrator.principalRef,
            householdId,
            capabilities: assetRestorationCapabilities(
              context.administrator.capabilities,
            ),
          });
          if (result.kind === "forbidden") {
            return reject(result, "DELETED_ASSET_LIST_FORBIDDEN");
          }
          const assetIds = result.kind === "no-data" ? [] : result.assetIds;
          const assets = await Promise.all(
            assetIds.map(async (assetId) => {
              const [canonical, legacy] = await Promise.all([
                database
                  .collection("households")
                  .doc(householdId)
                  .collection("assets")
                  .doc(assetId)
                  .get(),
                database.collection("assets").doc(assetId).get(),
              ]);
              const canonicalData = canonical.data();
              const legacyData = legacy.data();
              const deletedAt = canonicalData?.deletedAt ?? legacyData?.deletedAt;
              const asIso =
                typeof deletedAt === "string"
                  ? deletedAt
                  : typeof deletedAt?.toDate === "function"
                    ? deletedAt.toDate().toISOString()
                    : undefined;
              return {
                assetId,
                name:
                  (typeof canonicalData?.name === "string"
                    ? canonicalData.name
                    : undefined) ??
                  (typeof legacyData?.name === "string" ? legacyData.name : assetId),
                lifecycleState: "deleted" as const,
                aggregateVersion:
                  typeof canonicalData?.aggregateVersion === "number"
                    ? canonicalData.aggregateVersion
                    : typeof legacyData?.aggregateVersion === "number"
                      ? legacyData.aggregateVersion
                      : 1,
                ...(asIso === undefined ? {} : { deletedAt: asIso }),
              };
            }),
          );
          return { assets };
        },
      },
    ],
    [
      "restore-deleted-asset",
      {
        async execute(context) {
          const payload = context.envelope.payload as Record<string, unknown>;
          if (
            !exactKeys(payload, [
              "householdId",
              "assetId",
              "auditReason",
              "expectedVersion",
            ])
          ) {
            throw new AdminAccessRejection("INVALID_PAYLOAD");
          }
          const householdId = requiredString(
            payload.householdId,
            "HOUSEHOLD_ID_REQUIRED",
          );
          const assetId = requiredString(payload.assetId, "ASSET_ID_REQUIRED");
          const auditReason = requiredString(
            payload.auditReason,
            "ASSET_RESTORE_AUDIT_REASON_REQUIRED",
          );
          const expectedVersion = requiredVersion(payload.expectedVersion);
          const result = await assetLifecycleApplication({
            database,
            principalRef: context.administrator.principalRef,
            householdId,
            idempotencyKey: context.envelope.idempotencyKey,
            requestedAt: context.requestedAt,
            requestId: context.envelope.requestId,
          }).restoreDeletedAsset({
            actor: {
              actorId: context.administrator.principalRef,
              householdId,
              capabilities: assetRestorationCapabilities(
                context.administrator.capabilities,
              ),
            },
            commandId: context.envelope.requestId,
            idempotencyKey: context.envelope.idempotencyKey,
            assetId,
            expectedVersion,
            restoredOn: seoulLocalDate(context.requestedAt),
            auditReason,
          });
          if (result.kind === "success") return result;
          return reject(
            "code" in result ? result : {},
            "ADMIN_ASSET_RESTORE_FAILED",
          );
        },
      },
    ],
  ];
}

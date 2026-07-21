import type * as firestore from "firebase-admin/firestore";

import { FirebaseAssetOwnerProfileStore } from "../../adapters/firebase/access/firebaseAssetOwnerProfileStore";
import { createAssetOwnerProfileApplication } from "../../contexts/access/asset-owner-profile/application/assetOwnerProfileApplication";
import {
  HouseholdQueryRejection,
  type HouseholdQueryHandler,
} from "./householdQuery";

function exactKeys(
  payload: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): boolean {
  const set = new Set(allowed);
  return Object.keys(payload).every((key) => set.has(key));
}

export function createAccessHouseholdQueryHandlers(
  database: firestore.Firestore,
): ReadonlyMap<string, HouseholdQueryHandler> {
  return new Map([
    [
      "access.list-asset-owner-profiles.v1",
      {
        async execute(context) {
          const payload = context.envelope.payload;
          if (
            !exactKeys(payload, ["includeArchived"]) ||
            (payload.includeArchived !== undefined &&
              typeof payload.includeArchived !== "boolean")
          ) {
            throw new HouseholdQueryRejection("INVALID_PAYLOAD");
          }
          const householdId = context.envelope.householdId;
          if (householdId === undefined) {
            throw new HouseholdQueryRejection("HOUSEHOLD_ID_REQUIRED");
          }
          const memberActor = context.actor;
          const administrator = context.administrator;
          if (memberActor === undefined && administrator === undefined) {
            throw new HouseholdQueryRejection("FORBIDDEN");
          }
          const principalRef =
            memberActor?.principalUid ?? administrator?.principalRef ?? "missing";
          const application = createAssetOwnerProfileApplication({
            store: new FirebaseAssetOwnerProfileStore(database, {
              householdId,
              principalUid: principalRef,
              idempotencyKey: context.envelope.queryId,
              payloadFingerprint: context.envelope.queryId,
              requestedAt: new Date().toISOString(),
              commandId: context.envelope.queryId,
            }),
            ids: { nextDependentProfileId: () => "unused-profile-id" },
          });
          const result = await application.listAssetOwnerProfiles(
            memberActor === undefined
              ? {
                  principalUid: principalRef,
                  householdId,
                  capabilities: administrator?.capabilities.filter(
                    (capability): capability is "admin.asset-owner-profile.archive" =>
                      capability === "admin.asset-owner-profile.archive",
                  ) ?? [],
                }
              : {
                  principalUid: memberActor.principalUid,
                  householdId: memberActor.householdId,
                  actingMemberId: memberActor.actingMemberId,
                  capabilities: memberActor.capabilities.filter(
                    (capability): capability is "household.asset-owner-profile.write" =>
                      capability === "household.asset-owner-profile.write",
                  ),
                },
            { includeArchived: payload.includeArchived === true },
          );
          if (result.kind === "forbidden") {
            throw new HouseholdQueryRejection(result.code);
          }
          return { profiles: result.kind === "success" ? result.profiles : [] };
        },
      },
    ],
  ]);
}

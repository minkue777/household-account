import type * as firestore from "firebase-admin/firestore";

import type { AdminAccessHandler, AdminAccessOperation } from "./adminAccess";
import { createAdminAssetAccessHandlers } from "./handlers/adminAssetAccessHandlers";
import { createAdminHouseholdAccessHandlers } from "./handlers/adminHouseholdAccessHandlers";
import { createAdminMemberAccessHandlers } from "./handlers/adminMemberAccessHandlers";

export function createFirebaseAdminAccessHandlers(
  database: firestore.Firestore,
): ReadonlyMap<AdminAccessOperation, AdminAccessHandler> {
  return new Map<AdminAccessOperation, AdminAccessHandler>([
    ...createAdminHouseholdAccessHandlers(database),
    ...createAdminMemberAccessHandlers(database),
    ...createAdminAssetAccessHandlers(database),
  ]);
}

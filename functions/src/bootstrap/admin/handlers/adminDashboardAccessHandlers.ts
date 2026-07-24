import type * as firestore from "firebase-admin/firestore";

import { FirebaseAdminDashboardReader } from "../../../adapters/firebase/admin/firebaseAdminDashboardReader";
import {
  AdminAccessRejection,
  type AdminAccessHandler,
  type AdminAccessOperation,
} from "../adminAccess";
import { exactKeys } from "./adminAccessHandlerSupport";

type HandlerEntry = readonly [AdminAccessOperation, AdminAccessHandler];

export function createAdminDashboardAccessHandlers(
  database: firestore.Firestore,
): readonly HandlerEntry[] {
  return [
    [
      "get-dashboard",
      {
        async execute(context) {
          const payload = context.envelope.payload as Record<string, unknown>;
          if (!exactKeys(payload, ["rangeDays"])) {
            throw new AdminAccessRejection("INVALID_PAYLOAD");
          }
          const rangeDays = payload.rangeDays ?? 14;
          if (
            typeof rangeDays !== "number" ||
            !Number.isSafeInteger(rangeDays) ||
            rangeDays < 7 ||
            rangeDays > 30
          ) {
            throw new AdminAccessRejection("INVALID_PAYLOAD");
          }
          return new FirebaseAdminDashboardReader(database, {
            serviceName: process.env.K_SERVICE?.trim() || "household-account-functions",
            revision: process.env.K_REVISION?.trim() || "local",
            region:
              process.env.FUNCTION_REGION?.trim() ||
              process.env.GCLOUD_REGION?.trim() ||
              "asia-northeast3",
          }).read({
            generatedAt: context.requestedAt,
            rangeDays,
          });
        },
      },
    ],
  ];
}

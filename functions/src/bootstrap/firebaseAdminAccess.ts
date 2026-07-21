import * as functions from "firebase-functions/v1";

import { db, REGION } from "../config";
import {
  createAdminAccessRouter,
  type AdminAccessResult,
} from "./admin/adminAccess";
import { createFirebaseAdminAccessHandlers } from "./admin/firebaseAdminAccessHandlers";
import { verifiedSystemAdministrator } from "./verifiedSystemAdministrator";

export { createFirebaseAdminAccessHandlers } from "./admin/firebaseAdminAccessHandlers";

export interface AdminAccessWireResponse {
  readonly contractVersion: "admin-access-response.v1";
  readonly requestId: string;
  readonly result:
    | { readonly kind: "succeeded"; readonly value: unknown }
    | {
        readonly kind: "rejected";
        readonly error: { readonly code: string; readonly retryable: boolean };
      };
}

const router = createAdminAccessRouter({
  handlers: createFirebaseAdminAccessHandlers(db),
});

function requestId(request: unknown): string {
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    return "invalid-admin-request";
  }
  const value = (request as Record<string, unknown>).requestId;
  return typeof value === "string" ? value : "invalid-admin-request";
}

export function toAdminAccessWireResponse(
  request: unknown,
  result: AdminAccessResult,
): AdminAccessWireResponse {
  const id = result.requestId ?? requestId(request);
  return result.kind === "success"
    ? {
        contractVersion: "admin-access-response.v1",
        requestId: id,
        result: { kind: "succeeded", value: result.data },
      }
    : {
        contractVersion: "admin-access-response.v1",
        requestId: id,
        result: {
          kind: "rejected",
          error: { code: result.code, retryable: result.retryable },
        },
      };
}

export const executeAdminAccess = functions
  .region(REGION)
  .runWith({ enforceAppCheck: true })
  .https.onCall(async (data, context): Promise<AdminAccessWireResponse> => {
    const result = await router.execute({
      principalUid: context.auth?.uid,
      administrator: verifiedSystemAdministrator(
        context.auth?.uid,
        context.auth?.token,
      ),
      request: data,
      requestedAt: new Date().toISOString(),
    });
    return toAdminAccessWireResponse(data, result);
  });

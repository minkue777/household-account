import { createFirebaseHouseholdCommandRegistry } from "./householdCommandRegistry";
import * as functions from "firebase-functions/v1";

import {
  FirebaseHouseholdCommandMembershipAdapter,
  FirebaseHouseholdCommandReceiptAdapter,
  Sha256HouseholdCommandHashAdapter,
} from "../adapters/firebase/commands/firebaseHouseholdCommandInfrastructure";
import { db, REGION } from "../config";
import type { HouseholdCommandResult } from "./commands/householdCommand";
import { createHouseholdCommandRouter } from "./commands/householdCommandRouter";
import { verifiedSystemAdministrator } from "./verifiedSystemAdministrator";
import { startInteractiveLatencyInvocation } from "../observability/interactiveLatency";

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

const handlers = createFirebaseHouseholdCommandRegistry(db);

const router = createHouseholdCommandRouter({
  handlers,
  memberships: new FirebaseHouseholdCommandMembershipAdapter(db),
  receipts: new FirebaseHouseholdCommandReceiptAdapter(db),
  hashes: new Sha256HouseholdCommandHashAdapter(),
});

export const executeHouseholdCommand = functions
  .region(REGION)
  .runWith({
    secrets: ["SHORTCUT_CREDENTIAL_PEPPER"],
  })
  .https.onCall(async (data, context): Promise<HouseholdCommandWireResponse> => {
    const latency = startInteractiveLatencyInvocation(
      "executeHouseholdCommand",
    );
    return latency.run(async () => {
      try {
        const result = await router.execute({
          principalUid: context.auth?.uid,
          administrator: verifiedSystemAdministrator(
            context.auth?.uid,
            context.auth?.token,
          ),
          request: data,
          requestedAt: new Date().toISOString(),
        });
        const response = toHouseholdCommandWireResponse(data, result);
        latency.complete(
          result.kind === "success" ? "succeeded" : "rejected",
        );
        return response;
      } catch (error) {
        latency.complete("failed");
        throw error;
      }
    });
  });

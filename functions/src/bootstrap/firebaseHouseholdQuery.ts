import { createFirebaseHouseholdQueryRegistry } from "./householdQueryRegistry";
import * as functions from "firebase-functions/v1";

import { FirebaseHouseholdCommandMembershipAdapter } from "../adapters/firebase/commands/firebaseHouseholdCommandInfrastructure";
import { db, REGION } from "../config";
import type { HouseholdQueryResult } from "./queries/householdQuery";
import { createHouseholdQueryRouter } from "./queries/householdQueryRouter";
import { verifiedSystemAdministrator } from "./verifiedSystemAdministrator";
import { startInteractiveLatencyInvocation } from "../observability/interactiveLatency";
import { readDeploymentMarker, type DeploymentMarker } from "./deploymentMarker";
import { FirebaseExternalQueryQuota } from "../adapters/firebase/operations/firebaseExternalQueryQuota";

export interface HouseholdQueryWireResponse {
  readonly deployment?: DeploymentMarker;
  readonly contractVersion: "household-query-response.v1";
  readonly queryId: string;
  readonly result:
    | { readonly kind: "succeeded"; readonly value: unknown }
    | {
        readonly kind: "rejected";
        readonly error: { readonly code: string; readonly retryable: boolean };
      };
}

function requestQueryId(request: unknown): string {
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    return "invalid-query";
  }
  const queryId = (request as Record<string, unknown>).queryId;
  return typeof queryId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(queryId)
    ? queryId
    : "invalid-query";
}

export function toHouseholdQueryWireResponse(
  request: unknown,
  result: HouseholdQueryResult,
): HouseholdQueryWireResponse {
  const queryId = result.queryId ?? requestQueryId(request);
  return result.kind === "success"
    ? {
        contractVersion: "household-query-response.v1",
        queryId,
        result: { kind: "succeeded", value: result.data },
      }
    : {
        contractVersion: "household-query-response.v1",
        queryId,
        result: {
          kind: "rejected",
          error: { code: result.code, retryable: result.retryable },
        },
      };
}

const handlers = createFirebaseHouseholdQueryRegistry(db);

const router = createHouseholdQueryRouter({
  handlers,
  memberships: new FirebaseHouseholdCommandMembershipAdapter(db),
  externalQueryQuota: new FirebaseExternalQueryQuota(db),
});

export const executeHouseholdQuery = functions
  .region(REGION)
  .https.onCall(async (data, context): Promise<HouseholdQueryWireResponse> => {
    const latency = startInteractiveLatencyInvocation("executeHouseholdQuery");
    return latency.run(async () => {
      try {
        const result = await router.execute({
          principalUid: context.auth?.uid,
          sourceIp: context.rawRequest.ip,
          administrator: verifiedSystemAdministrator(
            context.auth?.uid,
            context.auth?.token,
          ),
          request: data,
        });
        const response = toHouseholdQueryWireResponse(data, result);
        latency.complete(
          result.kind === "success" ? "succeeded" : "rejected",
        );
        const deployment = context.auth?.uid !== undefined && result.kind === "success" ? readDeploymentMarker() : undefined;
        return deployment === undefined ? response : { ...response, deployment };
      } catch (error) {
        latency.complete("failed");
        throw error;
      }
    });
  });

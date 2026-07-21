import type {
  TenantActorContext,
  TenantAuthorizationDecision,
  TenantCollection,
  TenantOperation,
  TenantResourceScope,
} from "../model/tenantAuthorization";

const SERVER_ONLY_COLLECTIONS: ReadonlySet<TenantCollection> = new Set([
  "notificationEndpoints",
  "notificationDebugLogs",
  "providerHealth",
]);

function authorizeMemberOperation(
  actor: Extract<TenantActorContext, { principalKind: "member" }>,
  operation: TenantOperation,
  resource: TenantResourceScope | undefined,
): TenantAuthorizationDecision {
  if (operation.householdId === undefined) {
    return { kind: "validation-error", code: "HOUSEHOLD_ID_REQUIRED" };
  }
  if (operation.householdId !== actor.householdId) {
    return { kind: "forbidden", code: "HOUSEHOLD_SCOPE_REQUIRED" };
  }
  if (
    resource?.householdId !== undefined &&
    resource.householdId !== actor.householdId
  ) {
    return { kind: "forbidden", code: "HOUSEHOLD_SCOPE_REQUIRED" };
  }

  if (operation.action === "create" || operation.action === "update") {
    if (operation.nextHouseholdId === undefined) {
      return { kind: "validation-error", code: "HOUSEHOLD_ID_REQUIRED" };
    }
    const currentHouseholdId = resource?.householdId ?? operation.householdId;
    if (operation.nextHouseholdId !== currentHouseholdId) {
      return { kind: "validation-error", code: "HOUSEHOLD_ID_IMMUTABLE" };
    }
  }

  return { kind: "allowed" };
}

function authorizeAdministratorOperation(
  actor: Extract<TenantActorContext, { principalKind: "administrator" }>,
  operation: TenantOperation,
): TenantAuthorizationDecision {
  if (operation.collection !== "households") {
    return { kind: "forbidden", code: "CAPABILITY_REQUIRED" };
  }
  const capability =
    operation.action === "read" || operation.action === "list"
      ? "admin.households.read"
      : "admin.households.write";
  return actor.capabilities.includes(capability)
    ? { kind: "allowed" }
    : { kind: "forbidden", code: "CAPABILITY_REQUIRED" };
}

export function authorizeTenantOperation(
  actor: TenantActorContext,
  operation: TenantOperation,
  resource?: TenantResourceScope,
): TenantAuthorizationDecision {
  if (SERVER_ONLY_COLLECTIONS.has(operation.collection)) {
    return { kind: "forbidden", code: "SERVER_ONLY_COLLECTION" };
  }
  return actor.principalKind === "member"
    ? authorizeMemberOperation(actor, operation, resource)
    : authorizeAdministratorOperation(actor, operation);
}

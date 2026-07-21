export type TenantCollection =
  | "households"
  | "transactions"
  | "categories"
  | "recurringPlans"
  | "localCurrencyBalances"
  | "assets"
  | "notificationEndpoints"
  | "notificationDebugLogs"
  | "providerHealth";

export type TenantCrudAction =
  | "read"
  | "list"
  | "create"
  | "update"
  | "delete";

export type TenantAdministratorCapability =
  | "admin.households.read"
  | "admin.households.write";

export interface MemberActorContext {
  principalKind: "member";
  principalUid: string;
  householdId: string;
  actingMemberId: string;
}

export interface AdministratorActorContext {
  principalKind: "administrator";
  principalRef: string;
  capabilities: readonly TenantAdministratorCapability[];
}

export type TenantActorContext =
  | MemberActorContext
  | AdministratorActorContext;

export interface TenantOperation {
  action: TenantCrudAction;
  collection: TenantCollection;
  recordId?: string;
  householdId?: string;
  nextHouseholdId?: string;
}

export interface TenantResourceScope {
  householdId?: string;
}

export type TenantAuthorizationDecision =
  | { kind: "allowed" }
  | {
      kind: "forbidden";
      code:
        | "HOUSEHOLD_SCOPE_REQUIRED"
        | "SERVER_ONLY_COLLECTION"
        | "CAPABILITY_REQUIRED";
    }
  | {
      kind: "validation-error";
      code: "HOUSEHOLD_ID_REQUIRED" | "HOUSEHOLD_ID_IMMUTABLE";
    };

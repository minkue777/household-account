import type { VerifiedAccessPrincipal } from "../../../../membership/application/ports/in/verifiedAccessPrincipal";
import type {
  TenantActorContext,
  TenantAdministratorCapability,
  TenantAuthorizationDecision,
  TenantCollection,
  TenantCrudAction,
  TenantOperation,
  TenantResourceScope,
} from "../../../domain/model/tenantAuthorization";

export type AuthenticatedTenantRequester =
  | {
      kind: "member";
      principal: VerifiedAccessPrincipal;
      wireHouseholdId: string;
      wireMemberId: string;
    }
  | {
      kind: "administrator";
      principalRef: string;
      capabilities: readonly TenantAdministratorCapability[];
    };

export type ResolveTenantActorResult =
  | { kind: "resolved"; actorContext: TenantActorContext }
  | { kind: "unauthenticated"; code: "AUTH_REQUIRED" }
  | { kind: "forbidden"; code: "HOUSEHOLD_SCOPE_REQUIRED" };

export type TenantOperationResult =
  | {
      kind: "allowed";
      visibleRecordIds?: readonly string[];
      changedRecordId?: string;
    }
  | { kind: "unauthenticated"; code: "AUTH_REQUIRED" }
  | Exclude<TenantAuthorizationDecision, { kind: "allowed" }>;

export interface TenantAuthorizationInputPort {
  resolveActorContext(
    requester: AuthenticatedTenantRequester | undefined,
  ): Promise<ResolveTenantActorResult>;
  authorizeHouseholdAction(
    actorContext: TenantActorContext,
    operation: TenantOperation,
    resource?: TenantResourceScope,
  ): TenantAuthorizationDecision;
}

export type {
  TenantActorContext,
  TenantAdministratorCapability,
  TenantAuthorizationDecision,
  TenantCollection,
  TenantCrudAction,
  TenantOperation,
  TenantResourceScope,
  VerifiedAccessPrincipal,
};

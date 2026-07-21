import { findActiveMembership } from "../../membership/domain/model/accessMembership";
import { authorizeTenantOperation } from "../domain/policies/tenantAuthorizationPolicy";
import type {
  AuthenticatedTenantRequester,
  ResolveTenantActorResult,
  TenantAuthorizationInputPort,
} from "./ports/in/tenantAuthorizationInputPort";
import type { TenantAuthorizationMembershipPort } from "./ports/out/tenantAuthorizationMembershipPort";

export interface TenantAuthorizationApplicationDependencies {
  memberships: TenantAuthorizationMembershipPort;
}

class DefaultTenantAuthorizationApplication
  implements TenantAuthorizationInputPort
{
  constructor(
    private readonly dependencies: TenantAuthorizationApplicationDependencies,
  ) {}

  async resolveActorContext(
    requester: AuthenticatedTenantRequester | undefined,
  ): Promise<ResolveTenantActorResult> {
    if (requester === undefined) {
      return { kind: "unauthenticated", code: "AUTH_REQUIRED" };
    }
    if (requester.kind === "administrator") {
      return {
        kind: "resolved",
        actorContext: {
          principalKind: "administrator",
          principalRef: requester.principalRef,
          capabilities: [...requester.capabilities],
        },
      };
    }

    const membership = await this.dependencies.memberships.findByPrincipalUid(
      requester.principal.uid,
    );
    const activeMembership = findActiveMembership(
      membership === undefined ? [] : [membership],
      requester.principal.uid,
    );
    if (
      activeMembership === undefined ||
      requester.wireHouseholdId !== activeMembership.householdId ||
      requester.wireMemberId !== activeMembership.memberId
    ) {
      return { kind: "forbidden", code: "HOUSEHOLD_SCOPE_REQUIRED" };
    }
    return {
      kind: "resolved",
      actorContext: {
        principalKind: "member",
        principalUid: activeMembership.principalUid,
        householdId: activeMembership.householdId,
        actingMemberId: activeMembership.memberId,
      },
    };
  }

  authorizeHouseholdAction: TenantAuthorizationInputPort["authorizeHouseholdAction"] = (
    actorContext,
    operation,
    resource,
  ) => authorizeTenantOperation(actorContext, operation, resource);
}

export function createTenantAuthorizationApplication(
  dependencies: TenantAuthorizationApplicationDependencies,
): TenantAuthorizationInputPort {
  return new DefaultTenantAuthorizationApplication(dependencies);
}

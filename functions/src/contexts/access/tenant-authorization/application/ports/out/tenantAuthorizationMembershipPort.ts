import type { AccessMembership } from "../../../../membership/domain/model/accessMembership";

export interface TenantAuthorizationMembershipPort {
  findByPrincipalUid(principalUid: string): Promise<AccessMembership | undefined>;
}

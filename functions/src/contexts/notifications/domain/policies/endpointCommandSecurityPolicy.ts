export interface EndpointPrincipalFact {
  uid: string;
  householdId: string;
  memberId: string;
}

export interface SecuredRegistrationPreflightFact {
  principal?: EndpointPrincipalFact;
  targetHouseholdId: string;
  targetMemberId: string;
  appAttestation: "valid" | "invalid" | "missing";
  fid: string;
  platform: string;
}

export type EndpointSecurityPreflight =
  | { kind: "AuthorizedForMembershipCheck"; principal: EndpointPrincipalFact }
  | { kind: "Unauthenticated"; code: "AUTH_REQUIRED" }
  | {
      kind: "Forbidden";
      code: "MEMBERSHIP_REQUIRED" | "APP_ATTESTATION_INVALID";
    }
  | {
      kind: "ValidationError";
      code: "FID_REQUIRED" | "MEMBER_ID_REQUIRED" | "PLATFORM_NOT_SUPPORTED";
    };

export function validateSecuredRegistrationPreflight(
  command: SecuredRegistrationPreflightFact,
): EndpointSecurityPreflight {
  if (command.principal === undefined) {
    return { kind: "Unauthenticated", code: "AUTH_REQUIRED" };
  }
  if (command.targetMemberId.trim().length === 0) {
    return { kind: "ValidationError", code: "MEMBER_ID_REQUIRED" };
  }
  if (command.fid.trim().length === 0) {
    return { kind: "ValidationError", code: "FID_REQUIRED" };
  }
  if (command.platform !== "android" && command.platform !== "ios-pwa") {
    return { kind: "ValidationError", code: "PLATFORM_NOT_SUPPORTED" };
  }
  if (command.appAttestation !== "valid") {
    return { kind: "Forbidden", code: "APP_ATTESTATION_INVALID" };
  }
  if (
    command.principal.householdId !== command.targetHouseholdId ||
    command.principal.memberId !== command.targetMemberId
  ) {
    return { kind: "Forbidden", code: "MEMBERSHIP_REQUIRED" };
  }

  return {
    kind: "AuthorizedForMembershipCheck",
    principal: command.principal,
  };
}

export function isCurrentEndpointActor(input: {
  principal: EndpointPrincipalFact | undefined;
  targetHouseholdId: string;
  targetMemberId: string;
  membershipStatus: "active" | "removed" | "missing";
}):
  | { kind: "Authorized"; principal: EndpointPrincipalFact }
  | { kind: "Unauthenticated"; code: "AUTH_REQUIRED" }
  | { kind: "Forbidden"; code: "MEMBERSHIP_REQUIRED" } {
  if (input.principal === undefined) {
    return { kind: "Unauthenticated", code: "AUTH_REQUIRED" };
  }
  if (
    input.principal.householdId !== input.targetHouseholdId ||
    input.principal.memberId !== input.targetMemberId ||
    input.membershipStatus !== "active"
  ) {
    return { kind: "Forbidden", code: "MEMBERSHIP_REQUIRED" };
  }
  return { kind: "Authorized", principal: input.principal };
}

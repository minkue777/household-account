import type { VerifiedAccessPrincipal } from "../../../../membership/application/ports/in/verifiedAccessPrincipal";

export type VerifiedGooglePrincipal = VerifiedAccessPrincipal;

export interface MembershipView {
  householdId: string;
  memberId: string;
  status: "active";
  capabilities: readonly string[];
}

export type ResolveSignedInUserResult =
  | { kind: "membership-found"; membership: MembershipView }
  | { kind: "first-visit-required"; choices: readonly ["create", "join"] };

export type CreateHouseholdResult =
  | {
      kind: "success";
      householdId: string;
      memberId: string;
      membership: MembershipView;
      initializationStatus: "pending" | "completed" | "failed";
    }
  | {
      kind: "validation-error";
      code:
        | "HOUSEHOLD_NAME_REQUIRED"
        | "SELF_DISPLAY_NAME_REQUIRED"
        | "FORBIDDEN_IDENTITY_FIELD";
    }
  | { kind: "conflict"; code: "PRINCIPAL_ALREADY_JOINED" }
  | { kind: "forbidden"; code: string };

export type CreateInvitationResult =
  | {
      kind: "success";
      invitationCode: string;
      householdId: string;
      expiresAt: string;
    }
  | { kind: "forbidden"; code: string };

export type JoinHouseholdResult =
  | {
      kind: "success";
      householdId: string;
      memberId: string;
      membership: MembershipView;
    }
  | {
      kind: "validation-error";
      code: "SELF_DISPLAY_NAME_REQUIRED" | "FORBIDDEN_IDENTITY_FIELD";
    }
  | {
      kind: "conflict";
      code: "PRINCIPAL_ALREADY_JOINED" | "INVITATION_EXPIRED_OR_USED";
    }
  | { kind: "forbidden"; code: string };

export interface GoogleOnboardingInputPort {
  resolveSignedInUser(
    principal: VerifiedGooglePrincipal,
  ): Promise<ResolveSignedInUserResult>;
  createHouseholdWithSelf(
    principal: VerifiedGooglePrincipal,
    input: {
      householdName: string;
      selfDisplayName: string;
      idempotencyKey: string;
    },
  ): Promise<CreateHouseholdResult>;
  createInvitationCode(
    principal: VerifiedGooglePrincipal,
    input: { householdId: string; idempotencyKey: string },
  ): Promise<CreateInvitationResult>;
  joinHouseholdAsSelf(
    principal: VerifiedGooglePrincipal,
    input: {
      invitationCode: string;
      selfDisplayName: string;
      idempotencyKey: string;
    },
  ): Promise<JoinHouseholdResult>;
}

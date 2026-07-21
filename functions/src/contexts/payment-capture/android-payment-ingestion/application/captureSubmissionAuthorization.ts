import type { TenantAuthorizationInputPort } from "../../../access/public";
import type {
  CaptureApprovalActor,
  CaptureAuthorizationResult,
} from "./ports/in/captureAuthorizationInputPort";

export type CaptureAuthorizationFailure = Exclude<
  CaptureAuthorizationResult,
  { readonly kind: "Created" }
>;

export type CaptureSubmissionAuthorizationDecision =
  | CaptureAuthorizationFailure
  | {
      readonly kind: "Authorized";
      readonly householdId: string;
      readonly creatorMemberId: string;
    };

const SUBMIT_CAPABILITY = "paymentCapture:submit";

export function authorizeCaptureSubmission(input: {
  readonly tenantAuthorization: TenantAuthorizationInputPort;
  readonly actor?: CaptureApprovalActor;
  readonly envelopeHouseholdId?: string;
}): CaptureSubmissionAuthorizationDecision {
  const actor = input.actor;
  if (actor === undefined) {
    return { kind: "Unauthenticated", code: "AUTH_REQUIRED" };
  }
  if (actor.householdId === undefined || actor.householdId.trim() === "") {
    return { kind: "Forbidden", code: "HOUSEHOLD_REQUIRED" };
  }
  if (
    actor.actingMemberId === undefined ||
    actor.actingMemberId.trim() === ""
  ) {
    return { kind: "Forbidden", code: "ACTOR_MISMATCH" };
  }
  if (!actor.capabilities.includes(SUBMIT_CAPABILITY)) {
    return { kind: "Forbidden", code: "CAPABILITY_REQUIRED" };
  }

  const tenantDecision = input.tenantAuthorization.authorizeHouseholdAction(
    {
      principalKind: "member",
      principalUid: actor.principalId,
      householdId: actor.householdId,
      actingMemberId: actor.actingMemberId,
    },
    {
      action: "create",
      collection: "transactions",
      householdId: input.envelopeHouseholdId,
      nextHouseholdId: input.envelopeHouseholdId,
    },
  );
  return tenantDecision.kind === "allowed"
    ? {
        kind: "Authorized",
        householdId: actor.householdId,
        creatorMemberId: actor.actingMemberId,
      }
    : { kind: "Forbidden", code: "ACTOR_MISMATCH" };
}

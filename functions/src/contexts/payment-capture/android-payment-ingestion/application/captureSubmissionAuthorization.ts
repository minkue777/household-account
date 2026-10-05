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
  readonly actor?: CaptureApprovalActor;
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

  return {
    kind: "Authorized",
    householdId: actor.householdId,
    creatorMemberId: actor.actingMemberId,
  };
}

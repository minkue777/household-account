export interface CaptureApprovalActor {
  readonly principalId: string;
  readonly householdId?: string;
  readonly actingMemberId?: string;
  readonly capabilities: readonly string[];
}

export interface SubmitCaptureApprovalInput {
  readonly actor?: CaptureApprovalActor;
  readonly envelopeHouseholdId?: string;
  readonly observationId: string;
}

export type CaptureAuthorizationResult =
  | {
      readonly kind: "Created";
      readonly transactionId: string;
      readonly householdId: string;
      readonly creatorMemberId: string;
    }
  | { readonly kind: "Unauthenticated"; readonly code: "AUTH_REQUIRED" }
  | {
      readonly kind: "Forbidden";
      readonly code:
        | "HOUSEHOLD_REQUIRED"
        | "ACTOR_MISMATCH"
        | "CAPABILITY_REQUIRED";
    };

export interface CaptureAuthorizationInputPort {
  submitApproval(
    input: SubmitCaptureApprovalInput,
  ): Promise<CaptureAuthorizationResult>;
}

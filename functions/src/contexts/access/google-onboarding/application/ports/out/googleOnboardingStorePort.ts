import { GoogleOnboardingState } from "../../../domain/model/googleOnboarding";

export class GoogleOnboardingPayloadConflict extends Error {
  constructor() { super("IDEMPOTENCY_PAYLOAD_MISMATCH"); }
}

export interface GoogleOnboardingMutation<T> {
  state: GoogleOnboardingState;
  value: T;
}

export interface GoogleOnboardingStorePort {
  transact<T>(
    operation: (current: GoogleOnboardingState) => GoogleOnboardingMutation<T>,
  ): Promise<T>;
}

export interface GoogleOnboardingClockPort {
  now(): string;
}

export interface GoogleOnboardingIdentityPort {
  nextHouseholdId(idempotencyKey: string): string;
  nextMemberId(idempotencyKey: string): string;
}

export interface InvitationSecurityPort {
  issueCode(idempotencyKey: string): string;
  hashCode(invitationCode: string): string;
}

export interface HouseholdInitializationPort {
  initialize(
    householdId: string,
  ): Promise<"pending" | "completed" | "failed">;
}

export interface HouseholdInitializationStorePort {
  finalizeInitialization(
    householdId: string,
    status: "pending" | "completed" | "failed",
  ): Promise<"pending" | "completed" | "failed">;
}

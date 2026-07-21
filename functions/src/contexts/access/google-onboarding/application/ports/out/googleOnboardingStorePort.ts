import { GoogleOnboardingState } from "../../../domain/model/googleOnboarding";

export interface GoogleOnboardingMutation<T> {
  state: GoogleOnboardingState;
  value: T;
}

export interface GoogleOnboardingStorePort {
  read(): Promise<GoogleOnboardingState>;
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

import { LegacyMembershipState } from "../../../domain/model/legacyMembership";

export interface LegacyMembershipMutation<T> {
  state: LegacyMembershipState;
  value: T;
}

export type LegacyMembershipResolutionRead =
  | { kind: "success"; state: LegacyMembershipState }
  | { kind: "retryable-failure"; code: "MEMBERSHIP_LOOKUP_UNAVAILABLE" };

export interface LegacyMembershipStorePort {
  read(): Promise<LegacyMembershipState>;
  readForResolution(): Promise<LegacyMembershipResolutionRead>;
  transact<T>(
    operation: (current: LegacyMembershipState) => LegacyMembershipMutation<T>,
  ): Promise<T>;
}

export interface LegacyMemberOwnerProfileIdPort {
  profileIdForMember(householdId: string, memberId: string): string;
}

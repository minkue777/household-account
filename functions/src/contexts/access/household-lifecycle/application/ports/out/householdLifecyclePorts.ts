import type { HouseholdLifecycleState } from "../../../domain/model/householdLifecycle";

export interface HouseholdLifecycleMutation<T> {
  state: HouseholdLifecycleState;
  value: T;
}

export interface HouseholdLifecycleUnitOfWorkPort {
  read(): Promise<HouseholdLifecycleState>;
  transact<T>(
    operation: (
      state: HouseholdLifecycleState,
    ) => HouseholdLifecycleMutation<T>,
  ): Promise<T>;
}

export interface HouseholdLifecycleClockPort {
  now(): string;
}

export interface HouseholdLifecycleIdentityPort {
  nextPurgeProcessId(idempotencyKey: string): string;
}

export interface HouseholdLifecycleHashPort {
  hashSensitiveReference(value: string): string;
}

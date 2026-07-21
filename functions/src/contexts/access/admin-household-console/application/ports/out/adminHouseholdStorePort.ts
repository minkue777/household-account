import { AdminHouseholdState } from "../../../domain/model/adminHousehold";

export interface AdminHouseholdMutation<T> {
  state: AdminHouseholdState;
  value: T;
}

export interface AdminHouseholdStorePort {
  read(): Promise<AdminHouseholdState>;
  transact<T>(
    operation: (current: AdminHouseholdState) => AdminHouseholdMutation<T>,
  ): Promise<T>;
}

export interface AdminHouseholdIdentityPort {
  nextHouseholdId(idempotencyKey: string): string;
  nextLegacyShareKey(idempotencyKey: string): string;
}

export interface AdminHouseholdClockPort {
  now(): string;
}

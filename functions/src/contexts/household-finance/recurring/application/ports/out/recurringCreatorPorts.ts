import type {
  RecurringCreatorMigrationState,
  RecurringPlan,
} from "../../../domain/model/recurringPlan";
import type { RecurringCreatedTransactionView } from "../in/recurringCreatorInputPort";

export interface RecurringCreatorMutation<T> {
  state: RecurringCreatorMigrationState;
  value: T;
}

export interface RecurringCreatorStorePort {
  read(): Promise<RecurringCreatorMigrationState>;
  transact<T>(
    operation: (
      current: RecurringCreatorMigrationState,
    ) => RecurringCreatorMutation<T>,
  ): Promise<T>;
}

export interface RecurringMemberIdentityPort {
  belongsToHousehold(householdId: string, memberId: string): Promise<boolean>;
}

export type RecordRecurringCreatorTransactionResult =
  | { kind: "created"; transaction: RecurringCreatedTransactionView }
  | { kind: "already-processed"; transaction: RecurringCreatedTransactionView };

export interface RecurringCreatorLedgerPort {
  recordRecurringTransaction(input: {
    householdId: string;
    plan: RecurringPlan & { creatorMemberId: string };
    targetMonth: string;
    idempotencyKey: string;
  }): Promise<RecordRecurringCreatorTransactionResult>;
}

export interface RecurringCreatorClockPort {
  now(): string;
}

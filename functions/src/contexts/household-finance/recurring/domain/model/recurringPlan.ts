export interface RecurringPlan {
  householdId: string;
  planId: string;
  merchant: string;
  amountInWon: number;
  categoryId: string;
  dayOfMonth: number;
  memo: string;
  active: boolean;
  creatorMemberId?: string;
  firstApplicableMonth: string;
  createdAt: string;
  updatedAt: string;
  lifecycleState: "active" | "deleted";
  version: number;
}

export interface CreatorMappedRecurringPlan extends RecurringPlan {
  creatorMemberId: string;
}

export function hasRecurringPlanCreator(
  plan: RecurringPlan,
): plan is CreatorMappedRecurringPlan {
  return (
    typeof plan.creatorMemberId === "string" &&
    plan.creatorMemberId.trim().length > 0
  );
}

export interface RecurringPlanCommandReceipt {
  commandId: string;
  payloadSignature: string;
  resultKind: "created" | "updated" | "deleted";
  planId: string;
  plan: CreatorMappedRecurringPlan;
}

export interface RecurringPlanChangedEvent {
  eventType: "RecurringPlanChanged.v1";
  householdId: string;
  planId: string;
  active: boolean;
  dayOfMonth: number;
  changeKind: "created" | "updated" | "deleted";
  planVersion: number;
}

export interface RecurringPlanManagementState {
  plans: readonly RecurringPlan[];
  receipts: readonly RecurringPlanCommandReceipt[];
  events: readonly RecurringPlanChangedEvent[];
}

export interface RecurringCreatorMigrationReceipt {
  commandId: string;
  householdId: string;
  planId: string;
  creatorMemberId: string;
  migrationActorId: string;
  migratedAt: string;
  previousPlanVersion: number;
}

export interface RecurringCreatorMigrationState {
  plans: readonly RecurringPlan[];
  receipts: readonly RecurringCreatorMigrationReceipt[];
  events: readonly RecurringPlanChangedEvent[];
}

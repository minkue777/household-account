import type { ProcessRecurringTargetResult } from "../../../domain/model/recurringProcessing";

export interface RecurringProcessActor {
  readonly kind: "system";
  readonly capabilities: readonly "recurring.process"[];
}

export type ProcessDueRecurringPlansResult =
  | {
      readonly kind: "success";
      readonly results: readonly ProcessRecurringTargetResult[];
      readonly nextCheckpoint?: string;
      readonly completed: boolean;
    }
  | {
      readonly kind: "partial-failure";
      readonly results: readonly ProcessRecurringTargetResult[];
      readonly retryFromCheckpoint: string;
      readonly completed: false;
    }
  | { readonly kind: "validation-error"; readonly code: string }
  | {
      readonly kind: "retryable-failure";
      readonly code: string;
      readonly checkpoint?: string;
    };

export interface RecurringSchedulerWorkflowInputPort {
  processMonth(input: {
    actor: RecurringProcessActor;
    householdId: string;
    planId: string;
    targetMonth: string;
  }): Promise<ProcessRecurringTargetResult>;
  processDue(input: {
    actor: RecurringProcessActor;
    asOfDate: string;
    householdZoneId: "Asia/Seoul";
    checkpoint?: string;
    limit: number;
  }): Promise<ProcessDueRecurringPlansResult>;
}

export type { ProcessRecurringTargetResult };

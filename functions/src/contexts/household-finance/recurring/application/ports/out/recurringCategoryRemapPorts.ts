import type {
  CategoryRemapResult,
  RecurringCategoryRemapDecision,
  RecurringCategoryRemapState,
} from "../../../domain/model/recurringCategoryRemap";

export interface RecurringCategoryRemapUnitOfWork {
  transact(
    retryCursor: string | undefined,
    decide: (
      state: RecurringCategoryRemapState,
    ) => RecurringCategoryRemapDecision,
  ): Promise<CategoryRemapResult>;
  read(): Promise<RecurringCategoryRemapState>;
}

export interface RecurringCategoryRemapHashPort {
  hash(value: string): string;
}

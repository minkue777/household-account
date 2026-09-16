import {
  applyMonthlySplitPolicy,
  type MonthlyInstallment,
  type MonthlySplitInput,
  type MonthlySplitResult,
} from "./domain/policies/monthlySplit";

export type { MonthlyInstallment, MonthlySplitInput, MonthlySplitResult };

export interface MonthlySplitPolicy {
  split(input: MonthlySplitInput): MonthlySplitResult;
}

export function splitMonthly(input: MonthlySplitInput): MonthlySplitResult {
  return applyMonthlySplitPolicy(input);
}

export type {
  CompatibleLedgerReadResult,
  CompatibleLedgerReader,
  LedgerPeriodQuery,
  LedgerPeriodQueryResult,
} from "./application/queries/ledgerPeriodQuery";
export type { BasicLedgerCommands } from "./application/commands/basicLedgerService";
export type { CapturedLineageCancellationCommands } from "./application/commands/cancelCapturedLineage";
export type { MonthlySplitLifecycleCommands } from "./application/commands/monthlySplitLifecycleService";
export type { ItemSplitRestorationCommands } from "./application/commands/itemSplitRestorationService";
export type { LedgerTransformationCommands } from "./application/commands/transformationLineageService";
export type {
  LedgerCommandResult,
  LedgerSummaryResult,
  LedgerTransactionType,
  LedgerTransactionView,
} from "./domain/model/ledgerTransaction";
export type {
  CapturedLineageCancellationResult,
  CapturedLineageCancellationState,
  CapturedMonthlyTransaction,
} from "./domain/model/capturedLineageCancellation";
export type {
  SplitLifecycleResult,
  SplitTransaction,
} from "./domain/model/monthlySplitLifecycle";
export type {
  ItemSplitResult,
  ItemSplitSnapshot,
  ItemSplitTransaction,
} from "./domain/model/itemSplitRestoration";
export type {
  CaptureProvenance,
  LedgerTransformationResult,
  LedgerTransformationState,
  LedgerTransformationTransaction,
} from "./domain/model/transformationLineage";
export {
  prepareRecurringPosting,
  type RecurringLedgerPosting,
  type RecurringLedgerRecordedEvent,
} from "./domain/policies/recurringPosting";

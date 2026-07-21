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
export type { MergeIntegrityCommands } from "./application/commands/mergeIntegrityService";
export type { LedgerTransformationCommands } from "./application/commands/transformationLineageService";
export type { UnmergeRestorationCommands } from "./application/commands/unmergeRestorationService";
export type { StructuralMutationCommands } from "./application/commands/structuralMutationService";
export type { LedgerUpdateDeleteCommands } from "./application/commands/updateDeleteLifecycleService";
export type { LocalCurrencyLedgerCommands } from "./application/commands/localCurrencyLedgerService";
export type { LocalCurrencyMetadataCommands } from "./application/commands/localCurrencyMetadataService";
export type { MonthlyReconfigurationCommands } from "./application/commands/monthlyReconfigurationService";
export type { LedgerSearchQuery } from "./application/queries/ledgerSearchQuery";
export type { DetailedLedgerSearchQuery } from "./application/queries/detailedLedgerSearchQuery";
export type {
  LedgerSearchController,
  SearchControllerView,
  SearchRequestIdentity,
  SearchResponse,
} from "./application/controllers/ledgerSearchController";
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
  MergeIntegrityResult,
  MergeIntegritySnapshot,
  MergeLeafSnapshot,
  MergeTransaction,
} from "./domain/model/mergeIntegrity";
export type {
  CaptureProvenance,
  LedgerTransformationResult,
  LedgerTransformationState,
  LedgerTransformationTransaction,
} from "./domain/model/transformationLineage";
export type {
  UnmergeLeafSnapshot,
  UnmergeRestorationResult,
  UnmergeTransaction,
} from "./domain/model/unmergeRestoration";
export type {
  StructuralLedgerState,
  StructuralMutationResult,
  StructuralOperation,
} from "./domain/model/structuralMutation";
export type {
  LedgerUpdateDeleteResult,
  LedgerUpdateDeleteSnapshot,
  MutableLedgerTransaction,
} from "./domain/model/updateDeleteLifecycle";
export type {
  LedgerSearchFact,
  LedgerSearchItem,
  LedgerSearchSourceResult,
  LedgerSearchSummary,
  SearchLedgerResult,
} from "./domain/model/ledgerSearch";
export type {
  LedgerDetailedSearchResult,
  LedgerSearchableTransaction,
  SearchCardDefinition,
} from "./domain/model/detailedLedgerSearch";
export type {
  LocalCurrencyLedgerMutationResult,
  LocalCurrencyLedgerQueryResult,
  LocalCurrencyLedgerRow,
  LocalCurrencyLedgerState,
} from "./domain/model/localCurrencyLedger";
export type {
  LocalCurrencyMetadataResult,
  LocalCurrencyMetadataTransaction,
} from "./domain/model/localCurrencyMetadata";
export type {
  MonthlyReconfigurationResult,
  MonthlyReconfigurationTransaction,
} from "./domain/model/monthlyReconfiguration";

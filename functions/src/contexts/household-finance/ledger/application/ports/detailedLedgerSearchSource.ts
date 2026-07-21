import type {
  LedgerSearchableTransaction,
  SearchCardDefinition,
} from "../../domain/model/detailedLedgerSearch";

export type DetailedLedgerSearchSourceResult =
  | {
      kind: "ready";
      transactions: readonly LedgerSearchableTransaction[];
      cardDefinitions: readonly SearchCardDefinition[];
      sourceRevision: string;
    }
  | { kind: "RetryableFailure"; code: string };

export interface DetailedLedgerSearchSource {
  load(): Promise<DetailedLedgerSearchSourceResult>;
}

export interface SearchCursorIssuer {
  next(): string;
}

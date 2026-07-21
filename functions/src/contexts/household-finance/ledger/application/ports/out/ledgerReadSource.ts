import type { StoredLedgerReadRow } from "../../../domain/model/ledgerReadFact";

export type { StoredLedgerReadRow } from "../../../domain/model/ledgerReadFact";

export type LedgerReadSourceResult =
  | { kind: "success"; rows: readonly StoredLedgerReadRow[] }
  | { kind: "contract-failure"; code: string }
  | { kind: "retryable-failure"; code: string };

export interface LedgerReadSource {
  load(): Promise<LedgerReadSourceResult>;
}

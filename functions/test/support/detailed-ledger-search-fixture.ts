import { createDetailedLedgerSearchQuery } from "../../src/contexts/household-finance/ledger/application/queries/detailedLedgerSearchQuery";
import type { DetailedLedgerSearchSource } from "../../src/contexts/household-finance/ledger/application/ports/detailedLedgerSearchSource";
import type {
  LedgerSearchableTransaction,
  SearchCardDefinition,
} from "../../src/contexts/household-finance/ledger/domain/model/detailedLedgerSearch";

export function createDetailedLedgerSearchFixtureSubject(fixture: {
  transactions: readonly LedgerSearchableTransaction[];
  cardDefinitions: readonly SearchCardDefinition[];
  sourceRevision: string;
}) {
  let cursorSequence = 0;
  const source: DetailedLedgerSearchSource = {
    load: async () => ({ kind: "ready", ...fixture }),
  };
  return createDetailedLedgerSearchQuery({
    source,
    cursorIssuer: { next: () => `opaque-search-cursor-${++cursorSequence}` },
  });
}

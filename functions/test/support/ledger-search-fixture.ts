import { createLedgerSearchQuery } from "../../src/contexts/household-finance/ledger/application/queries/ledgerSearchQuery";
import type { LedgerSearchSource } from "../../src/contexts/household-finance/ledger/application/ports/ledgerSearchSource";
import type { LedgerSearchSourceResult } from "../../src/contexts/household-finance/ledger/domain/model/ledgerSearch";

export function createLedgerSearchFixtureSubject(
  fixture: LedgerSearchSourceResult,
) {
  const source: LedgerSearchSource = {
    load: async () => fixture,
  };
  return createLedgerSearchQuery({ source });
}

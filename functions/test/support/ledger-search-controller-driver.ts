import { createLedgerSearchController } from "../../src/contexts/household-finance/ledger/application/controllers/ledgerSearchController";

export function createLedgerSearchControllerSubject() {
  return createLedgerSearchController();
}

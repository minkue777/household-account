import {
  createCompatibleLedgerReader,
  createLedgerPeriodQuery,
} from "../../src/contexts/household-finance/ledger/application/queries/ledgerPeriodQuery";
import type {
  LedgerReadSource,
  LedgerReadSourceResult,
  StoredLedgerReadRow,
} from "../../src/contexts/household-finance/ledger/application/ports/out/ledgerReadSource";

interface LedgerFixture {
  rows?: readonly StoredLedgerReadRow[];
  failureCode?: string;
  failure?: { kind: "contract-failure" | "retryable-failure"; code: string };
}

function fixtureSource(fixture: LedgerFixture): LedgerReadSource {
  return {
    load: async (): Promise<LedgerReadSourceResult> => {
      if (fixture.failure !== undefined) return fixture.failure;
      if (fixture.failureCode !== undefined) {
        return { kind: "retryable-failure", code: fixture.failureCode };
      }
      return { kind: "success", rows: fixture.rows ?? [] };
    },
  };
}

export function createLedgerPeriodTestSubject(fixture: LedgerFixture) {
  return createLedgerPeriodQuery(fixtureSource(fixture));
}

export function createCompatibleLedgerReadTestSubject(fixture: LedgerFixture) {
  return createCompatibleLedgerReader(fixtureSource(fixture));
}

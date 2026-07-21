import { createStructuralMutationCommands } from "../../src/contexts/household-finance/ledger/application/commands/structuralMutationService";
import type { StructuralMutationStore } from "../../src/contexts/household-finance/ledger/application/ports/structuralMutationStore";
import type { StructuralLedgerState } from "../../src/contexts/household-finance/ledger/domain/model/structuralMutation";

function clone(state: StructuralLedgerState): StructuralLedgerState {
  return {
    transactions: state.transactions.map((transaction) => ({ ...transaction })),
    claims: state.claims.map((claim) => ({ ...claim })),
    receipts: [...state.receipts],
    events: [...state.events],
  };
}

export function createStructuralMutationBoundariesFixtureSubject(fixture: {
  state: StructuralLedgerState;
  failCommit?: boolean;
}) {
  let state = clone(fixture.state);
  const store: StructuralMutationStore = {
    load: async () => clone(state),
    commit: async ({ state: next }) => {
      if (fixture.failCommit) {
        return { kind: "RetryableFailure", code: "LEDGER_UOW_COMMIT_FAILED" };
      }
      state = clone(next);
      return { kind: "success" };
    },
  };
  const commands = createStructuralMutationCommands({ store });
  return {
    ...commands,
    snapshot: () => clone(state),
  };
}

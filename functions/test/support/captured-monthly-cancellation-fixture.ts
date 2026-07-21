import { createCapturedLineageCancellationCommands } from "../../src/contexts/household-finance/ledger/application/commands/cancelCapturedLineage";
import type { CapturedLineageCancellationStore } from "../../src/contexts/household-finance/ledger/application/ports/capturedLineageCancellationStore";
import type {
  CapturedLineageCancellationResult,
  CapturedLineageCancellationState,
} from "../../src/contexts/household-finance/ledger/domain/model/capturedLineageCancellation";

function cloneState(
  state: CapturedLineageCancellationState,
): CapturedLineageCancellationState {
  return {
    transactions: state.transactions.map((transaction) => ({
      ...transaction,
      ...(transaction.monthlyGroup === undefined
        ? {}
        : { monthlyGroup: { ...transaction.monthlyGroup } }),
    })),
    claims: state.claims.map((claim) => ({ ...claim })),
    cancelledLineages: state.cancelledLineages.map((entry) => ({ ...entry })),
    events: state.events.map((event) => ({
      ...event,
      deletedTransactionIds: [...event.deletedTransactionIds],
    })),
  };
}

export function createCapturedMonthlyCancellationFixtureSubject(fixture: {
  now: string;
  state: CapturedLineageCancellationState;
}) {
  let state = cloneState(fixture.state);
  const receipts = new Map<string, CapturedLineageCancellationResult>();
  const store: CapturedLineageCancellationStore = {
    findReceipt: async (cancellationKey) => receipts.get(cancellationKey),
    load: async () => ({ kind: "ready", value: cloneState(state) }),
    commit: async ({ cancellationKey, state: nextState, result }) => {
      state = cloneState(nextState);
      receipts.set(cancellationKey, {
        ...result,
        deletedTransactionIds: [...result.deletedTransactionIds],
      });
      return { kind: "success" };
    },
  };
  const commands = createCapturedLineageCancellationCommands({
    store,
    clock: { now: () => fixture.now },
  });
  return {
    ...commands,
    snapshot: () => cloneState(state),
  };
}

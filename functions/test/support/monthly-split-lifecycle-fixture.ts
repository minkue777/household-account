import { createMonthlySplitLifecycleCommands } from "../../src/contexts/household-finance/ledger/application/commands/monthlySplitLifecycleService";
import type { MonthlySplitLifecycleStore } from "../../src/contexts/household-finance/ledger/application/ports/monthlySplitLifecycleStore";
import type {
  SplitLifecycleResult,
  SplitTransaction,
} from "../../src/contexts/household-finance/ledger/domain/model/monthlySplitLifecycle";

function clone(transaction: SplitTransaction): SplitTransaction {
  return {
    ...transaction,
    ...(transaction.splitGroup === undefined
      ? {}
      : { splitGroup: { ...transaction.splitGroup } }),
  };
}

export function createMonthlySplitLifecycleFixtureSubject(fixture: {
  transactions?: readonly SplitTransaction[];
  now?: string;
  failAtWriteIndex?: number;
}) {
  let transactions = (fixture.transactions ?? []).map(clone);
  const receipts = new Map<string, SplitLifecycleResult>();
  const store: MonthlySplitLifecycleStore = {
    findReceipt: async (operationKey) => receipts.get(operationKey),
    load: async () => transactions.map(clone),
    replaceAtomically: async ({
      operationKey,
      transactions: next,
      intendedWriteCount,
      result,
    }) => {
      if (
        fixture.failAtWriteIndex !== undefined &&
        fixture.failAtWriteIndex <= intendedWriteCount
      ) {
        return { kind: "retryable-failure", code: "LEDGER_COMMIT_FAILED" };
      }
      transactions = next.map(clone);
      receipts.set(operationKey, {
        ...result,
        transactionIds: [...result.transactionIds],
      });
      return { kind: "success" };
    },
  };
  const commands = createMonthlySplitLifecycleCommands({ store });
  return {
    ...commands,
    state: () => transactions.map(clone),
  };
}

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
  let loadedIds = new Set<string>();
  const receipts = new Map<string, SplitLifecycleResult>();
  const store: MonthlySplitLifecycleStore = {
    findReceipt: async (operationKey) => receipts.get(operationKey),
    load: async (selection) => {
      const selected =
        selection.kind === "empty"
          ? []
          : selection.kind === "transaction"
            ? transactions.filter(
              ({ transactionId }) =>
                transactionId === selection.transactionId,
            )
            : (() => {
              const parts = transactions.filter(
                ({ splitGroup }) => splitGroup?.groupId === selection.groupId,
              );
              const originalIds = new Set(
                parts.flatMap(({ splitGroup }) =>
                  splitGroup === undefined ? [] : [splitGroup.originalId],
                ),
              );
              return transactions.filter(
                ({ transactionId, splitGroup }) =>
                  splitGroup?.groupId === selection.groupId ||
                  originalIds.has(transactionId),
              );
            })();
      loadedIds = new Set(selected.map(({ transactionId }) => transactionId));
      return selected.map(clone);
    },
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
      const nextIds = new Set(next.map(({ transactionId }) => transactionId));
      transactions = [
        ...transactions.filter(
          ({ transactionId }) =>
            !loadedIds.has(transactionId) && !nextIds.has(transactionId),
        ),
        ...next.map(clone),
      ];
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

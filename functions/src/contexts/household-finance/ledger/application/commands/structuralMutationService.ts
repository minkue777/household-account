import type { StructuralMutationStore } from "../ports/structuralMutationStore";
import type {
  StructuralMutationResult,
  StructuralOperation,
} from "../../domain/model/structuralMutation";
import { guardStructuralMutation } from "../../domain/policies/structuralMutationGuard";

export interface StructuralMutationCommands {
  execute(input: {
    operation: StructuralOperation;
    operationKey: string;
    actor: {
      householdId: string;
      memberId: string;
      canWriteLedger: boolean;
    };
    targetIds: readonly string[];
    expectedVersions: Readonly<Record<string, number>>;
  }): Promise<StructuralMutationResult>;
}

export function createStructuralMutationCommands(input: {
  store: StructuralMutationStore;
}): StructuralMutationCommands {
  return {
    execute: async (command) => {
      const state = await input.store.load();
      const guarded = guardStructuralMutation({ ...command, state });
      if (guarded.kind !== "allowed") return guarded;

      const targetSet = new Set(command.targetIds);
      const changedTransactionIds =
        command.operation === "cancel-captured-lineage"
          ? []
          : [...command.targetIds];
      const nextState = {
        transactions: state.transactions.map((transaction) =>
          targetSet.has(transaction.transactionId)
            ? {
                ...transaction,
                aggregateVersion: transaction.aggregateVersion + 1,
              }
            : { ...transaction },
        ),
        claims: state.claims.map((claim) =>
          command.operation === "cancel-captured-lineage" &&
          targetSet.has(claim.claimId)
            ? { ...claim, state: "cancelled" as const, version: claim.version + 1 }
            : { ...claim },
        ),
        receipts: [...state.receipts, command.operationKey],
        events: [...state.events, `${command.operation}.v1`],
      };
      const result = { kind: "Committed" as const, changedTransactionIds };
      const committed = await input.store.commit({ state: nextState, result });
      return committed.kind === "success" ? result : committed;
    },
  };
}

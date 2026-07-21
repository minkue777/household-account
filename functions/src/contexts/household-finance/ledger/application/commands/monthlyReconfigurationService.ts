import type { MonthlyReconfigurationStore } from "../ports/monthlyReconfigurationStore";
import type { MonthlyReconfigurationResult } from "../../domain/model/monthlyReconfiguration";
import { applyMonthlySplitPolicy } from "../../domain/policies/monthlySplit";

export interface MonthlyReconfigurationCommands {
  reconfigure(input: {
    actor: { householdId: string; memberId: string };
    operationKey: string;
    groupId: string;
    months: number;
    expectedVersions: Readonly<Record<string, number>>;
  }): Promise<MonthlyReconfigurationResult>;
}

export function createMonthlyReconfigurationCommands(input: {
  store: MonthlyReconfigurationStore;
}): MonthlyReconfigurationCommands {
  return {
    reconfigure: async (command) => {
      const replay = await input.store.findReceipt(command.operationKey);
      if (replay !== undefined) return replay;
      const transactions = await input.store.load();
      const oldParts = transactions.filter(
        (transaction) =>
          transaction.householdId === command.actor.householdId &&
          transaction.lifecycleState === "active" &&
          transaction.monthlyGroup?.groupId === command.groupId,
      );
      const originalId = oldParts[0]?.monthlyGroup?.originalTransactionId;
      const original = transactions.find(
        (transaction) =>
          transaction.transactionId === originalId &&
          transaction.householdId === command.actor.householdId,
      );
      if (
        original === undefined ||
        oldParts.length === 0 ||
        [original, ...oldParts].some(
          (transaction) =>
            command.expectedVersions[transaction.transactionId] !==
            transaction.aggregateVersion,
        )
      ) {
        return { kind: "Conflict", code: "VERSION_MISMATCH" };
      }
      const split = applyMonthlySplitPolicy({
        amountInWon: original.amountInWon,
        startDate: original.accountingDate,
        months: command.months,
      });
      if (split.kind !== "success") {
        return { kind: "ValidationError", code: split.code };
      }
      const nextGroupId = `monthly-group:${command.operationKey}`;
      const groupVersion =
        Math.max(
          0,
          ...oldParts.map((part) => part.monthlyGroup?.groupVersion ?? 0),
        ) + 1;
      const created = split.installments.map((installment) => ({
        ...original,
        transactionId: `${nextGroupId}:part:${installment.sequence}`,
        lifecycleState: "active" as const,
        merchant: `${original.merchant} (${installment.sequence}/${installment.total})`,
        amountInWon: installment.amountInWon,
        accountingDate: installment.accountingDate,
        aggregateVersion: 1,
        monthlyGroup: {
          groupId: nextGroupId,
          originalTransactionId: original.transactionId,
          index: installment.sequence,
          total: installment.total,
          groupVersion,
        },
      }));
      const oldIds = new Set(oldParts.map((part) => part.transactionId));
      const retained = transactions.map((transaction) =>
        oldIds.has(transaction.transactionId)
          ? {
              ...transaction,
              lifecycleState: "superseded" as const,
              aggregateVersion: transaction.aggregateVersion + 1,
            }
          : { ...transaction },
      );
      const result = {
        kind: "Reconfigured" as const,
        activeTransactionIds: created.map(
          (transaction) => transaction.transactionId,
        ),
      };
      const committed = await input.store.commit({
        operationKey: command.operationKey,
        expectedVersions: command.expectedVersions,
        transactions: [...retained, ...created],
        result,
      });
      return committed.kind === "success" ? result : committed;
    },
  };
}

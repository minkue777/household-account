import type { LocalCurrencyLedgerStore } from "../ports/localCurrencyLedgerStore";
import type {
  LocalCurrencyLedgerMutationResult,
  LocalCurrencyLedgerQueryResult,
  LocalCurrencyLedgerRow,
} from "../../domain/model/localCurrencyLedger";
import {
  areLocalCurrencyTypesCompatible,
  isSelectableLocalCurrencyType,
} from "../../domain/policies/localCurrencyTypeCompatibility";

export interface LocalCurrencyLedgerCommands {
  list(input: {
    householdId: string;
    localCurrencyType: string;
    period: { startDate: string; endDate: string };
  }): Promise<LocalCurrencyLedgerQueryResult>;
  split(input: {
    operationKey: string;
    sourceId: string;
    expectedVersion: number;
    amountsInWon: readonly number[];
  }): Promise<LocalCurrencyLedgerMutationResult>;
  merge(input: {
    operationKey: string;
    transactionIds: readonly string[];
    expectedVersions: Readonly<Record<string, number>>;
  }): Promise<LocalCurrencyLedgerMutationResult>;
}

export function createLocalCurrencyLedgerCommands(input: {
  store: LocalCurrencyLedgerStore;
}): LocalCurrencyLedgerCommands {
  return {
    list: async (query) => {
      if (!isSelectableLocalCurrencyType(query.localCurrencyType)) {
        return {
          kind: "validation-error",
          code: "LOCAL_CURRENCY_TYPE_REQUIRED",
        };
      }
      const state = await input.store.load();
      const transactionIds = state.transactions
        .filter(
          (transaction) =>
            transaction.householdId === query.householdId &&
            transaction.lifecycleState === "active" &&
            transaction.localCurrencyType === query.localCurrencyType,
        )
        .map((transaction) => transaction.transactionId);
      return transactionIds.length === 0
        ? { kind: "no-data" }
        : { kind: "success", transactionIds };
    },

    split: async (command) => {
      const replay = await input.store.findReceipt(command.operationKey);
      if (replay !== undefined) return replay;
      const state = await input.store.load();
      const source = state.transactions.find(
        (transaction) =>
          transaction.transactionId === command.sourceId &&
          transaction.lifecycleState === "active",
      );
      if (
        source === undefined ||
        source.aggregateVersion !== command.expectedVersion
      ) {
        return { kind: "conflict", code: "VERSION_MISMATCH" };
      }
      if (
        command.amountsInWon.length < 2 ||
        command.amountsInWon.some(
          (amount) => !Number.isSafeInteger(amount) || amount <= 0,
        ) ||
        command.amountsInWon.reduce((sum, amount) => sum + amount, 0) !==
          source.amountInWon
      ) {
        return { kind: "validation-error", code: "INVALID_SPLIT_AMOUNTS" };
      }
      const derived = command.amountsInWon.map<LocalCurrencyLedgerRow>(
        (amountInWon, index) => ({
          transactionId: `${source.transactionId}:part:${index + 1}:${command.operationKey}`,
          householdId: source.householdId,
          lifecycleState: "active",
          amountInWon,
          ...(source.localCurrencyType === undefined
            ? {}
            : { localCurrencyType: source.localCurrencyType }),
          aggregateVersion: 1,
        }),
      );
      const next = state.transactions.map((transaction) =>
        transaction.transactionId === source.transactionId
          ? {
              ...transaction,
              lifecycleState: "superseded" as const,
              aggregateVersion: transaction.aggregateVersion + 1,
            }
          : { ...transaction },
      );
      next.push(...derived);
      const result = {
        kind: "success" as const,
        transactionIds: derived.map((transaction) => transaction.transactionId),
      };
      const committed = await input.store.commit({
        operationKey: command.operationKey,
        expectedVersions: { [source.transactionId]: command.expectedVersion },
        state: { transactions: next },
        result,
      });
      return committed.kind === "success" ? result : committed;
    },

    merge: async (command) => {
      const replay = await input.store.findReceipt(command.operationKey);
      if (replay !== undefined) return replay;
      const state = await input.store.load();
      const selected = command.transactionIds.map((transactionId) =>
        state.transactions.find(
          (transaction) =>
            transaction.transactionId === transactionId &&
            transaction.lifecycleState === "active",
        ),
      );
      if (
        selected.length < 2 ||
        selected.some((transaction) => transaction === undefined) ||
        selected.some(
          (transaction) =>
            transaction !== undefined &&
            command.expectedVersions[transaction.transactionId] !==
              transaction.aggregateVersion,
        )
      ) {
        return { kind: "conflict", code: "VERSION_MISMATCH" };
      }
      const rows = selected as readonly LocalCurrencyLedgerRow[];
      if (
        !areLocalCurrencyTypesCompatible(
          rows.map((transaction) => transaction.localCurrencyType),
        )
      ) {
        return { kind: "conflict", code: "LOCAL_CURRENCY_TYPE_MISMATCH" };
      }
      const first = rows[0];
      const merged: LocalCurrencyLedgerRow = {
        transactionId: `merged:${command.operationKey}`,
        householdId: first.householdId,
        lifecycleState: "active",
        amountInWon: rows.reduce(
          (sum, transaction) => sum + transaction.amountInWon,
          0,
        ),
        ...(first.localCurrencyType === undefined
          ? {}
          : { localCurrencyType: first.localCurrencyType }),
        aggregateVersion: 1,
      };
      const selectedIds = new Set(command.transactionIds);
      const next = state.transactions.map((transaction) =>
        selectedIds.has(transaction.transactionId)
          ? {
              ...transaction,
              lifecycleState: "superseded" as const,
              aggregateVersion: transaction.aggregateVersion + 1,
            }
          : { ...transaction },
      );
      next.push(merged);
      const result = {
        kind: "success" as const,
        transactionIds: [merged.transactionId],
      };
      const committed = await input.store.commit({
        operationKey: command.operationKey,
        expectedVersions: command.expectedVersions,
        state: { transactions: next },
        result,
      });
      return committed.kind === "success" ? result : committed;
    },
  };
}

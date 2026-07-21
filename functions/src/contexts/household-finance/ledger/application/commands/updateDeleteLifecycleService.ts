import type { LedgerUpdateDeleteStore } from "../ports/updateDeleteStore";
import type {
  LedgerUpdateDeleteResult,
  MutableLedgerTransaction,
} from "../../domain/model/updateDeleteLifecycle";
import {
  validateAccountingDate,
  validatePositiveWon,
  validateRequiredText,
} from "../../domain/policies/basicLedgerPolicy";

export interface LedgerUpdateDeleteCommands {
  update(input: {
    actor: { householdId: string; memberId: string; canWriteLedger: boolean };
    commandId: string;
    transactionId: string;
    expectedVersion: number;
    patch: {
      merchant?: string;
      amountInWon?: number;
      categoryId?: string;
      memo?: string;
      accountingDate?: string;
    };
  }): Promise<LedgerUpdateDeleteResult>;
  delete(input: {
    actor: { householdId: string; memberId: string; canWriteLedger: boolean };
    commandId: string;
    transactionId: string;
    expectedVersion: number;
  }): Promise<LedgerUpdateDeleteResult>;
}

export function createLedgerUpdateDeleteCommands(input: {
  store: LedgerUpdateDeleteStore;
}): LedgerUpdateDeleteCommands {
  async function loadForWrite(command: {
    actor: { householdId: string; canWriteLedger: boolean };
    commandId: string;
    transactionId: string;
    expectedVersion: number;
  }): Promise<
    | { kind: "ready"; transaction: MutableLedgerTransaction; transactions: readonly MutableLedgerTransaction[]; events: readonly { eventName: "TransactionChanged.v1" | "TransactionDeleted.v1"; transactionId: string; aggregateVersion: number }[] }
    | { kind: "result"; result: LedgerUpdateDeleteResult }
  > {
    const replay = await input.store.findReceipt(command.commandId);
    if (replay !== undefined) return { kind: "result", result: replay };
    if (!command.actor.canWriteLedger) {
      return { kind: "result", result: { kind: "Forbidden" } };
    }
    const state = await input.store.load();
    const transaction = state.transactions.find(
      (candidate) =>
        candidate.transactionId === command.transactionId &&
        candidate.householdId === command.actor.householdId &&
        candidate.lifecycleState === "active",
    );
    if (transaction === undefined) {
      return { kind: "result", result: { kind: "NotFound" } };
    }
    if (transaction.aggregateVersion !== command.expectedVersion) {
      return {
        kind: "result",
        result: {
          kind: "Conflict",
          code: "VERSION_MISMATCH",
          currentVersion: transaction.aggregateVersion,
        },
      };
    }
    return {
      kind: "ready",
      transaction,
      transactions: state.transactions,
      events: state.events,
    };
  }

  return {
    update: async (command) => {
      const loaded = await loadForWrite(command);
      if (loaded.kind !== "ready") return loaded.result;
      const validations = [
        command.patch.merchant === undefined
          ? { kind: "valid" as const }
          : validateRequiredText(command.patch.merchant, "MERCHANT_REQUIRED"),
        command.patch.amountInWon === undefined
          ? { kind: "valid" as const }
          : validatePositiveWon(command.patch.amountInWon),
        command.patch.categoryId === undefined
          ? { kind: "valid" as const }
          : validateRequiredText(command.patch.categoryId, "CATEGORY_REQUIRED"),
        command.patch.accountingDate === undefined
          ? { kind: "valid" as const }
          : validateAccountingDate(command.patch.accountingDate),
      ];
      const invalid = validations.find(
        (validation) => validation.kind === "validation-error",
      );
      if (invalid?.kind === "validation-error") {
        return { kind: "ValidationError", code: invalid.code };
      }
      const changed: MutableLedgerTransaction = {
        ...loaded.transaction,
        ...(command.patch.merchant === undefined
          ? {}
          : { merchant: command.patch.merchant.trim() }),
        ...(command.patch.amountInWon === undefined
          ? {}
          : { amountInWon: command.patch.amountInWon }),
        ...(command.patch.categoryId === undefined
          ? {}
          : { categoryId: command.patch.categoryId.trim() }),
        ...(command.patch.memo === undefined
          ? {}
          : { memo: command.patch.memo }),
        ...(command.patch.accountingDate === undefined
          ? {}
          : { accountingDate: command.patch.accountingDate }),
        aggregateVersion: loaded.transaction.aggregateVersion + 1,
      };
      const result = { kind: "Updated" as const, transaction: changed };
      const committed = await input.store.commit({
        commandId: command.commandId,
        transactionId: command.transactionId,
        expectedVersion: command.expectedVersion,
        snapshot: {
          transactions: loaded.transactions.map((transaction) =>
            transaction.transactionId === changed.transactionId
              ? changed
              : { ...transaction },
          ),
          events: [
            ...loaded.events.map((event) => ({ ...event })),
            {
              eventName: "TransactionChanged.v1",
              transactionId: changed.transactionId,
              aggregateVersion: changed.aggregateVersion,
            },
          ],
        },
        result,
      });
      return committed.kind === "success" ? result : committed;
    },

    delete: async (command) => {
      const loaded = await loadForWrite(command);
      if (loaded.kind !== "ready") return loaded.result;
      const deleted: MutableLedgerTransaction = {
        ...loaded.transaction,
        lifecycleState: "deleted",
        aggregateVersion: loaded.transaction.aggregateVersion + 1,
      };
      const result = {
        kind: "Deleted" as const,
        transactionId: deleted.transactionId,
        version: deleted.aggregateVersion,
      };
      const committed = await input.store.commit({
        commandId: command.commandId,
        transactionId: command.transactionId,
        expectedVersion: command.expectedVersion,
        snapshot: {
          transactions: loaded.transactions.map((transaction) =>
            transaction.transactionId === deleted.transactionId
              ? deleted
              : { ...transaction },
          ),
          events: [
            ...loaded.events.map((event) => ({ ...event })),
            {
              eventName: "TransactionDeleted.v1",
              transactionId: deleted.transactionId,
              aggregateVersion: deleted.aggregateVersion,
            },
          ],
        },
        result,
      });
      return committed.kind === "success" ? result : committed;
    },
  };
}

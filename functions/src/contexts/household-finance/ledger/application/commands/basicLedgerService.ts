import type {
  LedgerCategoryUsagePolicy,
  LedgerClock,
  LedgerCommandRepository,
  LedgerTransactionIdGenerator,
} from "../ports/basicLedgerRepository";
import type {
  LedgerCommandResult,
  LedgerSummaryResult,
  LedgerTransactionType,
  LedgerTransactionView,
} from "../../domain/model/ledgerTransaction";
import {
  applyTransactionPatch,
  validateAccountingDate,
  validatePositiveWon,
  validateRequiredText,
  type LedgerValidationResult,
} from "../../domain/policies/basicLedgerPolicy";

export interface BasicLedgerCommands {
  recordManualExpense(input: {
    commandId: string;
    actor: { householdId: string; actingMemberId: string };
    merchant: string;
    amountInWon: number;
    categoryId: string;
    accountingDate: string;
    memo?: string;
  }): Promise<LedgerCommandResult>;
  recordManualIncome(input: {
    commandId: string;
    actor: { householdId: string; actingMemberId: string };
    itemName: string;
    amountInWon: number;
    accountingDate: string;
    memo?: string;
  }): Promise<LedgerCommandResult>;
  update(input: {
    commandId: string;
    actor: { householdId: string; actingMemberId: string };
    transactionId: string;
    expectedVersion: number;
    patch: Partial<
      Pick<
        LedgerTransactionView,
        "merchant" | "memo" | "amountInWon" | "categoryId" | "accountingDate"
      >
    >;
  }): Promise<LedgerCommandResult>;
  delete(input: {
    commandId: string;
    actor: { householdId: string; actingMemberId: string };
    transactionId: string;
    expectedVersion: number;
  }): Promise<LedgerCommandResult>;
  summary(input: {
    householdId: string;
    transactionType: LedgerTransactionType;
    selectedDate: string;
    yearMonth: string;
    year: number;
  }): Promise<LedgerSummaryResult>;
  requestNotification(input: {
    commandId: string;
    actor: { householdId: string; actingMemberId: string };
    transactionId: string;
    expectedVersion: number;
  }): Promise<LedgerCommandResult>;
}

function localTime(now: string): string {
  const match = /T(\d{2}:\d{2})/.exec(now);
  if (match === null) throw new Error("Clock은 ISO-8601 local time을 반환해야 합니다.");
  return match[1];
}

function firstError(
  validations: readonly LedgerValidationResult[],
): Extract<LedgerValidationResult, { kind: "validation-error" }> | undefined {
  return validations.find(
    (validation): validation is Extract<
      LedgerValidationResult,
      { kind: "validation-error" }
    > => validation.kind === "validation-error",
  );
}

function seoulLocalTime(instantText: string): string {
  // Keep the legacy ISO-shape guard while applying the business timezone below.
  localTime(instantText);
  const instant = new Date(instantText);
  if (!Number.isFinite(instant.getTime())) {
    throw new Error("Clock must return an ISO-8601 instant");
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

export function createBasicLedgerCommands(input: {
  repository: LedgerCommandRepository;
  clock: LedgerClock;
  idGenerator: LedgerTransactionIdGenerator;
  categories: LedgerCategoryUsagePolicy;
}): BasicLedgerCommands {
  async function commit(
    commandId: string,
    transaction: LedgerTransactionView,
    event: {
      type: string;
      transactionId: string;
      requesterMemberId?: string;
    },
  ): Promise<LedgerCommandResult> {
    const result = { kind: "success" as const, value: transaction };
    const committed = await input.repository.commit({
      commandId,
      householdId: transaction.householdId,
      occurredAt: input.clock.now(),
      transaction,
      event,
      result,
    });
    return committed.kind === "success"
      ? committed.replayedResult ?? result
      : committed;
  }

  async function existingOrLoad(
    commandId: string,
    transactionId: string,
    householdId: string,
  ): Promise<
    | { kind: "receipt"; result: LedgerCommandResult }
    | { kind: "transaction"; value: LedgerTransactionView }
    | { kind: "error"; result: LedgerCommandResult }
  > {
    const receipt = await input.repository.findReceipt(commandId);
    if (receipt !== undefined) return { kind: "receipt", result: receipt };
    const loaded = await input.repository.findTransaction(transactionId);
    if (loaded.kind !== "ready") return { kind: "error", result: loaded };
    if (
      loaded.value === undefined ||
      loaded.value.lifecycleState === "deleted" ||
      loaded.value.householdId !== householdId
    ) {
      return { kind: "error", result: { kind: "not-found" } };
    }
    return { kind: "transaction", value: loaded.value };
  }

  return {
    recordManualExpense: async (command) => {
      const receipt = await input.repository.findReceipt(command.commandId);
      if (receipt !== undefined) return receipt;
      const validation = firstError([
        validateRequiredText(command.merchant, "MERCHANT_REQUIRED"),
        validatePositiveWon(command.amountInWon),
        input.categories.isUsable(command.categoryId)
          ? { kind: "valid" }
          : { kind: "validation-error", code: "CATEGORY_NOT_USABLE" },
        validateAccountingDate(command.accountingDate),
      ]);
      if (validation !== undefined) return validation;

      const transactionId = input.idGenerator.next(command.commandId);
      const transaction: LedgerTransactionView = {
        transactionId,
        householdId: command.actor.householdId,
        transactionType: "expense",
        merchant: command.merchant.trim(),
        memo: command.memo ?? "",
        amountInWon: command.amountInWon,
        categoryId: command.categoryId,
        accountingDate: command.accountingDate,
        localTime: seoulLocalTime(input.clock.now()),
        cardDisplay: "수동",
        cardType: "manual",
        creatorMemberId: command.actor.actingMemberId,
        lifecycleState: "active",
        aggregateVersion: 1,
      };
      return commit(command.commandId, transaction, {
        type: "TransactionRecorded.v1",
        transactionId,
      });
    },

    recordManualIncome: async (command) => {
      const receipt = await input.repository.findReceipt(command.commandId);
      if (receipt !== undefined) return receipt;
      const validation = firstError([
        validateRequiredText(command.itemName, "ITEM_NAME_REQUIRED"),
        validatePositiveWon(command.amountInWon),
        validateAccountingDate(command.accountingDate),
      ]);
      if (validation !== undefined) return validation;

      const transactionId = input.idGenerator.next(command.commandId);
      const transaction: LedgerTransactionView = {
        transactionId,
        householdId: command.actor.householdId,
        transactionType: "income",
        merchant: "수입",
        memo: command.memo ?? command.itemName.trim(),
        amountInWon: command.amountInWon,
        categoryId: "etc",
        accountingDate: command.accountingDate,
        localTime: seoulLocalTime(input.clock.now()),
        cardDisplay: "수동",
        cardType: "manual",
        creatorMemberId: command.actor.actingMemberId,
        lifecycleState: "active",
        aggregateVersion: 1,
      };
      return commit(command.commandId, transaction, {
        type: "TransactionRecorded.v1",
        transactionId,
      });
    },

    update: async (command) => {
      const loaded = await existingOrLoad(
        command.commandId,
        command.transactionId,
        command.actor.householdId,
      );
      if (loaded.kind !== "transaction") return loaded.result;
      if (loaded.value.aggregateVersion !== command.expectedVersion) {
        return {
          kind: "conflict",
          code: "VERSION_MISMATCH",
          currentVersion: loaded.value.aggregateVersion,
        };
      }
      const validation = firstError([
        command.patch.merchant === undefined
          ? { kind: "valid" }
          : validateRequiredText(command.patch.merchant, "MERCHANT_REQUIRED"),
        command.patch.amountInWon === undefined
          ? { kind: "valid" }
          : validatePositiveWon(command.patch.amountInWon),
        command.patch.categoryId === undefined ||
        input.categories.isUsable(command.patch.categoryId)
          ? { kind: "valid" }
          : { kind: "validation-error", code: "CATEGORY_NOT_USABLE" },
        command.patch.accountingDate === undefined
          ? { kind: "valid" }
          : validateAccountingDate(command.patch.accountingDate),
      ]);
      if (validation !== undefined) return validation;
      const updated = applyTransactionPatch(loaded.value, command.patch);
      return commit(command.commandId, updated, {
        type: "TransactionChanged.v1",
        transactionId: updated.transactionId,
      });
    },

    delete: async (command) => {
      const loaded = await existingOrLoad(
        command.commandId,
        command.transactionId,
        command.actor.householdId,
      );
      if (loaded.kind !== "transaction") return loaded.result;
      if (loaded.value.aggregateVersion !== command.expectedVersion) {
        return {
          kind: "conflict",
          code: "VERSION_MISMATCH",
          currentVersion: loaded.value.aggregateVersion,
        };
      }
      const deleted = {
        ...loaded.value,
        lifecycleState: "deleted" as const,
        aggregateVersion: loaded.value.aggregateVersion + 1,
      };
      return commit(command.commandId, deleted, {
        type: "TransactionDeleted.v1",
        transactionId: deleted.transactionId,
      });
    },

    summary: async (query) => {
      const loaded = await input.repository.listTransactions(query.householdId);
      if (loaded.kind !== "ready") return loaded;
      const active = loaded.value.filter(
        (transaction) =>
          transaction.lifecycleState === "active" &&
          transaction.transactionType === query.transactionType &&
          transaction.accountingDate.startsWith(`${query.year}-`),
      );
      if (active.length === 0) return { kind: "no-data" };

      const categoryTotals = new Map<string, number>();
      for (const transaction of active) {
        categoryTotals.set(
          transaction.categoryId,
          (categoryTotals.get(transaction.categoryId) ?? 0) +
            transaction.amountInWon,
        );
      }
      return {
        kind: "success",
        selectedDateAmountInWon: active
          .filter((transaction) => transaction.accountingDate === query.selectedDate)
          .reduce((sum, transaction) => sum + transaction.amountInWon, 0),
        monthAmountInWon: active
          .filter((transaction) => transaction.accountingDate.startsWith(query.yearMonth))
          .reduce((sum, transaction) => sum + transaction.amountInWon, 0),
        yearAmountInWon: active.reduce(
          (sum, transaction) => sum + transaction.amountInWon,
          0,
        ),
        categories: [...categoryTotals.entries()]
          .map(([categoryId, amountInWon]) => ({ categoryId, amountInWon }))
          .sort(
            (left, right) =>
              right.amountInWon - left.amountInWon ||
              left.categoryId.localeCompare(right.categoryId),
          ),
      };
    },

    requestNotification: async (command) => {
      const loaded = await existingOrLoad(
        command.commandId,
        command.transactionId,
        command.actor.householdId,
      );
      if (loaded.kind !== "transaction") return loaded.result;
      if (loaded.value.aggregateVersion !== command.expectedVersion) {
        return {
          kind: "conflict",
          code: "VERSION_MISMATCH",
          currentVersion: loaded.value.aggregateVersion,
        };
      }
      if (loaded.value.transactionType !== "expense") {
        return {
          kind: "validation-error",
          code: "NOTIFICATION_REQUEST_EXPENSE_ONLY",
        };
      }
      const updated: LedgerTransactionView = {
        ...loaded.value,
        notificationRequest: {
          requesterMemberId: command.actor.actingMemberId,
          requestedAt: input.clock.now(),
        },
        aggregateVersion: loaded.value.aggregateVersion + 1,
      };
      return commit(command.commandId, updated, {
        type: "HouseholdNotificationRequested.v1",
        transactionId: updated.transactionId,
        requesterMemberId: command.actor.actingMemberId,
      });
    },
  };
}

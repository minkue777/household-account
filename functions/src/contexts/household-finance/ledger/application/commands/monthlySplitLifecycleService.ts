import type { MonthlySplitLifecycleStore } from "../ports/monthlySplitLifecycleStore";
import type {
  SplitLifecycleResult,
  SplitTransaction,
} from "../../domain/model/monthlySplitLifecycle";
import { applyMonthlySplitPolicy } from "../../domain/policies/monthlySplit";

export interface MonthlySplitLifecycleCommands {
  collapse(input: {
    operationKey: string;
    groupId: string;
    expectedVersions: Readonly<Record<string, number>>;
  }): Promise<SplitLifecycleResult>;
  reconfigure(input: {
    operationKey: string;
    groupId: string;
    months: number;
    expectedVersions: Readonly<Record<string, number>>;
  }): Promise<SplitLifecycleResult>;
  splitExisting(input: {
    operationKey: string;
    actor: { householdId: string; actingMemberId: string };
    transactionId: string;
    expectedVersion: number;
    months: number;
  }): Promise<SplitLifecycleResult>;
  splitNewManual(input: {
    operationKey: string;
    actor: { householdId: string; actingMemberId: string };
    draft: {
      transactionType: "expense" | "income";
      merchant: string;
      amountInWon: number;
      categoryId: string;
      accountingDate: string;
      memo: string;
    };
    months: number;
  }): Promise<SplitLifecycleResult>;
}

function copy(transaction: SplitTransaction): SplitTransaction {
  return {
    ...transaction,
    ...(transaction.splitGroup === undefined
      ? {}
      : { splitGroup: { ...transaction.splitGroup } }),
  };
}

function invalidSplit(
  code: string,
): Extract<SplitLifecycleResult, { kind: "validation-error" }> {
  const mapped =
    code === "MONTHS_BELOW_TWO"
      ? "MONTHLY_SPLIT_REQUIRES_AT_LEAST_TWO_MONTHS"
      : code === "AMOUNT_NOT_POSITIVE_INTEGER"
        ? "AMOUNT_MUST_BE_POSITIVE_INTEGER"
        : code;
  return { kind: "validation-error", code: mapped };
}

function groupMembers(
  transactions: readonly SplitTransaction[],
  groupId: string,
): { original: SplitTransaction; parts: readonly SplitTransaction[] } | undefined {
  const parts = transactions.filter(
    (transaction) => transaction.splitGroup?.groupId === groupId,
  );
  const originalId = parts[0]?.splitGroup?.originalId;
  if (originalId === undefined) return undefined;
  const original = transactions.find(
    (transaction) => transaction.transactionId === originalId,
  );
  if (original === undefined) return undefined;
  return { original, parts };
}

function versionsMatch(
  members: { original: SplitTransaction; parts: readonly SplitTransaction[] },
  expected: Readonly<Record<string, number>>,
): boolean {
  return [members.original, ...members.parts].every(
    (transaction) =>
      expected[transaction.transactionId] === transaction.aggregateVersion,
  );
}

function buildParts(input: {
  groupId: string;
  originalId: string;
  operationKey: string;
  source: SplitTransaction;
  months: number;
}):
  | { kind: "built"; transactions: readonly SplitTransaction[] }
  | Extract<SplitLifecycleResult, { kind: "validation-error" }> {
  const split = applyMonthlySplitPolicy({
    amountInWon: input.source.amountInWon,
    startDate: input.source.accountingDate,
    months: input.months,
  });
  if (split.kind !== "success") return invalidSplit(split.code);
  return {
    kind: "built",
    transactions: split.installments.map((installment) => ({
      transactionId: `${input.groupId}:part:${installment.sequence}:${input.operationKey}`,
      householdId: input.source.householdId,
      transactionType: input.source.transactionType,
      lifecycleState: "active" as const,
      amountInWon: installment.amountInWon,
      accountingDate: installment.accountingDate,
      merchant: `${input.source.merchant} (${installment.sequence}/${installment.total})`,
      categoryId: input.source.categoryId,
      memo: input.source.memo,
      cardType: input.source.cardType,
      cardDisplay: input.source.cardDisplay,
      creatorMemberId: input.source.creatorMemberId,
      source: input.source.source,
      originChannel: input.source.originChannel,
      aggregateVersion: 1,
      splitGroup: {
        groupId: input.groupId,
        index: installment.sequence,
        total: installment.total,
        originalId: input.originalId,
      },
    })),
  };
}

export function createMonthlySplitLifecycleCommands(input: {
  store: MonthlySplitLifecycleStore;
}): MonthlySplitLifecycleCommands {
  async function replay(operationKey: string) {
    return input.store.findReceipt(operationKey);
  }

  return {
    collapse: async (command) => {
      const prior = await replay(command.operationKey);
      if (prior !== undefined) return prior;
      const transactions = await input.store.load();
      const members = groupMembers(transactions, command.groupId);
      if (members === undefined || !versionsMatch(members, command.expectedVersions)) {
        return { kind: "conflict", code: "VERSION_MISMATCH" };
      }
      const partIds = new Set(
        members.parts.map((transaction) => transaction.transactionId),
      );
      const restored = {
        ...copy(members.original),
        lifecycleState: "active" as const,
        aggregateVersion: members.original.aggregateVersion + 1,
      };
      const next = transactions
        .filter((transaction) => !partIds.has(transaction.transactionId))
        .map((transaction) =>
          transaction.transactionId === restored.transactionId
            ? restored
            : copy(transaction),
        );
      const result = {
        kind: "success" as const,
        transactionIds: [restored.transactionId],
      };
      const committed = await input.store.replaceAtomically({
        operationKey: command.operationKey,
        transactions: next,
        intendedWriteCount: members.parts.length + 1,
        result,
      });
      return committed.kind === "success" ? result : committed;
    },

    reconfigure: async (command) => {
      const prior = await replay(command.operationKey);
      if (prior !== undefined) return prior;
      if (!Number.isSafeInteger(command.months) || command.months < 2) {
        return {
          kind: "validation-error",
          code: "MONTHLY_SPLIT_REQUIRES_AT_LEAST_TWO_MONTHS",
        };
      }
      const transactions = await input.store.load();
      const members = groupMembers(transactions, command.groupId);
      if (members === undefined || !versionsMatch(members, command.expectedVersions)) {
        return { kind: "conflict", code: "VERSION_MISMATCH" };
      }
      const created = buildParts({
        groupId: command.groupId,
        originalId: members.original.transactionId,
        operationKey: command.operationKey,
        source: members.original,
        months: command.months,
      });
      if (created.kind !== "built") return created;
      const createdTransactions = created.transactions;
      const partIds = new Set(
        members.parts.map((transaction) => transaction.transactionId),
      );
      const original = {
        ...copy(members.original),
        lifecycleState: "superseded" as const,
        aggregateVersion: members.original.aggregateVersion + 1,
      };
      const retained = transactions
        .filter((transaction) => !partIds.has(transaction.transactionId))
        .map((transaction) =>
          transaction.transactionId === original.transactionId
            ? original
            : copy(transaction),
        );
      const next = [...retained, ...createdTransactions];
      const result = {
        kind: "success" as const,
        transactionIds: createdTransactions.map(
          (transaction) => transaction.transactionId,
        ),
      };
      const committed = await input.store.replaceAtomically({
        operationKey: command.operationKey,
        transactions: next,
        intendedWriteCount:
          members.parts.length + createdTransactions.length + 1,
        result,
      });
      return committed.kind === "success" ? result : committed;
    },

    splitExisting: async (command) => {
      const prior = await replay(command.operationKey);
      if (prior !== undefined) return prior;
      if (!Number.isSafeInteger(command.months) || command.months < 2) {
        return {
          kind: "validation-error",
          code: "MONTHLY_SPLIT_REQUIRES_AT_LEAST_TWO_MONTHS",
        };
      }
      const transactions = await input.store.load();
      const source = transactions.find(
        (transaction) => transaction.transactionId === command.transactionId,
      );
      if (
        source === undefined ||
        source.householdId !== command.actor.householdId
      ) {
        return { kind: "conflict", code: "TRANSACTION_NOT_FOUND" };
      }
      if (source.aggregateVersion !== command.expectedVersion) {
        return { kind: "conflict", code: "VERSION_MISMATCH" };
      }
      if (source.lifecycleState !== "active" || source.splitGroup !== undefined) {
        return { kind: "conflict", code: "TRANSACTION_NOT_SPLITTABLE" };
      }

      const groupId = `monthly-group:${command.operationKey}`;
      const created = buildParts({
        groupId,
        originalId: source.transactionId,
        operationKey: command.operationKey,
        source,
        months: command.months,
      });
      if (created.kind !== "built") return created;
      const superseded = {
        ...copy(source),
        lifecycleState: "superseded" as const,
        aggregateVersion: source.aggregateVersion + 1,
      };
      const next = [
        ...transactions.map((transaction) =>
          transaction.transactionId === source.transactionId
            ? superseded
            : copy(transaction),
        ),
        ...created.transactions,
      ];
      const result = {
        kind: "success" as const,
        transactionIds: created.transactions.map(
          (transaction) => transaction.transactionId,
        ),
      };
      const committed = await input.store.replaceAtomically({
        operationKey: command.operationKey,
        transactions: next,
        intendedWriteCount: created.transactions.length + 1,
        result,
      });
      return committed.kind === "success" ? result : committed;
    },

    splitNewManual: async (command) => {
      const prior = await replay(command.operationKey);
      if (prior !== undefined) return prior;
      const originalId = `manual-original:${command.operationKey}`;
      const groupId = `monthly-group:${command.operationKey}`;
      const source: SplitTransaction = {
        transactionId: originalId,
        householdId: command.actor.householdId,
        transactionType: command.draft.transactionType,
        lifecycleState: "superseded",
        amountInWon: command.draft.amountInWon,
        accountingDate: command.draft.accountingDate,
        merchant: command.draft.merchant.trim(),
        categoryId: command.draft.categoryId,
        memo: command.draft.memo,
        cardType: "manual",
        cardDisplay: "수동",
        creatorMemberId: command.actor.actingMemberId,
        source: "manual",
        originChannel: "web",
        aggregateVersion: 1,
      };
      const created = buildParts({
        groupId,
        originalId,
        operationKey: command.operationKey,
        source,
        months: command.months,
      });
      if (created.kind !== "built") return created;
      const createdTransactions = created.transactions;
      const existing = await input.store.load();
      const result = {
        kind: "success" as const,
        transactionIds: createdTransactions.map(
          (transaction) => transaction.transactionId,
        ),
      };
      const committed = await input.store.replaceAtomically({
        operationKey: command.operationKey,
        transactions: [...existing.map(copy), source, ...createdTransactions],
        intendedWriteCount: createdTransactions.length + 1,
        result,
      });
      return committed.kind === "success" ? result : committed;
    },
  };
}

import { afterEach, describe, expect, it, vi } from "vitest";

import { createBasicLedgerCommands } from "../../../../src/contexts/household-finance/ledger/application/commands/basicLedgerService";
import type { LedgerCategoryUsagePolicy, LedgerCommandRepository } from "../../../../src/contexts/household-finance/ledger/application/ports/basicLedgerRepository";
import type { LedgerCommandResult, LedgerTransactionView } from "../../../../src/contexts/household-finance/ledger/domain/model/ledgerTransaction";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

const transaction: LedgerTransactionView = {
  transactionId: "transaction-1", householdId: "household-1",
  transactionType: "expense", merchant: "가맹점", memo: "", amountInWon: 1000,
  categoryId: "etc", accountingDate: "2026-09-07", localTime: "12:00",
  cardDisplay: "수동", cardType: "manual", creatorMemberId: "member-1",
  lifecycleState: "active", aggregateVersion: 1,
};
const command = {
  commandId: "update-1", transactionId: transaction.transactionId, expectedVersion: 1,
  actor: { householdId: transaction.householdId, actingMemberId: "member-1" },
  patch: { memo: "수정" },
};

function fixture(isUsable: LedgerCategoryUsagePolicy["isUsable"] = () => true) {
  const receipt = deferred<LedgerCommandResult | undefined>();
  const current = deferred<Awaited<ReturnType<LedgerCommandRepository["findTransaction"]>>>();
  const repository = {
    findReceipt: vi.fn(() => receipt.promise),
    findTransaction: vi.fn(() => current.promise),
    listTransactions: vi.fn<LedgerCommandRepository["listTransactions"]>(),
    commit: vi.fn<LedgerCommandRepository["commit"]>().mockResolvedValue({ kind: "success" }),
  };
  const categories = { isUsable: vi.fn(isUsable) };
  const commands = createBasicLedgerCommands({
    repository, categories,
    clock: { now: () => "2026-09-07T12:00:00.000Z" },
    idGenerator: { next: (id) => id },
  });
  return { receipt, current, repository, categories, commands };
}

afterEach(() => vi.useRealTimers());

describe("Ledger mutation read concurrency", () => {
  it.each(["update", "delete", "requestNotification"] as const)(
    "%s overlaps receipt and transaction reads but waits for receipt before committing", async (operation) => {
      const subject = fixture();
      const pending = subject.commands[operation](command);
      await Promise.resolve();
      expect(subject.repository.findReceipt).toHaveBeenCalledOnce();
      expect(subject.repository.findTransaction).toHaveBeenCalledOnce();
      subject.current.resolve({ kind: "ready", value: transaction });
      await Promise.resolve();
      expect(subject.repository.commit).not.toHaveBeenCalled();
      subject.receipt.resolve(undefined);
      await expect(pending).resolves.toMatchObject({ kind: "success" });
      expect(subject.repository.commit).toHaveBeenCalledOnce();
    },
  );

  it("returns a receipt without waiting for an unavailable current transaction", async () => {
    const subject = fixture();
    const pending = subject.commands.update(command);
    const replay = { kind: "success", value: { ...transaction, aggregateVersion: 2 } } as const;
    subject.receipt.resolve(replay);
    await expect(pending).resolves.toEqual(replay);
    expect(subject.repository.commit).not.toHaveBeenCalled();
    // A late rejection is consumed even after the replay has returned.
    subject.current.reject(new Error("late transaction read failure"));
    await Promise.resolve();
  });

  it("keeps the receipt payload mismatch ahead of a failed transaction read", async () => {
    const subject = fixture();
    const pending = subject.commands.update(command);
    subject.current.reject(new Error("transaction read failed"));
    await Promise.resolve();
    subject.receipt.resolve({ kind: "validation-error", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
    await expect(pending).resolves.toEqual({ kind: "validation-error", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
    expect(subject.repository.commit).not.toHaveBeenCalled();
  });

  it("preserves a read failure when there is no receipt and never commits", async () => {
    const subject = fixture();
    const pending = subject.commands.update(command);
    subject.current.resolve({ kind: "retryable-failure", code: "LEDGER_READ_UNAVAILABLE" });
    subject.receipt.resolve(undefined);
    await expect(pending).resolves.toEqual({ kind: "retryable-failure", code: "LEDGER_READ_UNAVAILABLE" });
    expect(subject.repository.commit).not.toHaveBeenCalled();
  });

  it("never falls back to a write when receipt lookup fails", async () => {
    const subject = fixture();
    const pending = subject.commands.update(command);
    subject.current.resolve({ kind: "ready", value: transaction });
    subject.receipt.reject(new Error("receipt read failed"));
    await expect(pending).rejects.toThrow("receipt read failed");
    expect(subject.repository.commit).not.toHaveBeenCalled();
  });

  it("overlaps a 100ms category check with a 100ms transaction read", async () => {
    vi.useFakeTimers();
    const subject = fixture(() => new Promise(resolve => setTimeout(() => resolve(true), 100)));
    subject.repository.findTransaction.mockImplementation(() => new Promise(resolve => {
      setTimeout(() => resolve({ kind: "ready", value: transaction }), 100);
    }));
    subject.receipt.resolve(undefined);
    const startedAt = Date.now();
    const pending = subject.commands.update({ ...command, patch: { categoryId: "food" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(subject.categories.isUsable).toHaveBeenCalledExactlyOnceWith("food");
    expect(subject.repository.findTransaction).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(99);
    expect(subject.repository.commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ kind: "success", value: { categoryId: "food" } });
    expect(Date.now() - startedAt).toBe(100);
  });

  it("does not check categories for a memo-only update", async () => {
    const subject = fixture(() => { throw new Error("category lookup must not start"); });
    subject.receipt.resolve(undefined);
    subject.current.resolve({ kind: "ready", value: transaction });
    await expect(subject.commands.update(command)).resolves.toMatchObject({ kind: "success" });
    expect(subject.categories.isUsable).not.toHaveBeenCalled();
  });

  it.each(["synchronous", "asynchronous"])("keeps %s category failures behind a stored receipt", async kind => {
    const categoryError = new Error("category unavailable");
    const subject = fixture(() => {
      if (kind === "synchronous") throw categoryError;
      return Promise.reject(categoryError);
    });
    const replay = { kind: "success", value: transaction } as const;
    subject.receipt.resolve(replay);
    await expect(subject.commands.update({ ...command, patch: { categoryId: "food" } })).resolves.toEqual(replay);
    expect(subject.repository.commit).not.toHaveBeenCalled();
  });

  it("returns a receipt without waiting for categories and consumes their late rejection", async () => {
    const category = deferred<boolean>();
    const subject = fixture(() => category.promise);
    const pending = subject.commands.update({ ...command, patch: { categoryId: "food" } });
    const replay = { kind: "success", value: transaction } as const;
    subject.receipt.resolve(replay);
    await expect(pending).resolves.toEqual(replay);
    category.reject(new Error("late category failure"));
    await Promise.resolve();
    expect(subject.repository.commit).not.toHaveBeenCalled();
  });

  it("keeps a receipt payload mismatch ahead of category failure", async () => {
    const subject = fixture(() => Promise.reject(new Error("category unavailable")));
    subject.receipt.resolve({ kind: "validation-error", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
    await expect(subject.commands.update({ ...command, patch: { categoryId: "food" } }))
      .resolves.toEqual({ kind: "validation-error", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
    expect(subject.repository.commit).not.toHaveBeenCalled();
  });

  it.each(["missing", "version", "receipt-failure", "transaction-failure"])(
    "keeps category read failure ahead of %s for a command without a receipt", async kind => {
      const categoryError = new Error("category unavailable");
      const subject = fixture(() => { throw categoryError; });
      if (kind === "receipt-failure") subject.receipt.reject(new Error("receipt unavailable"));
      else subject.receipt.resolve(undefined);
      if (kind === "transaction-failure") subject.current.reject(new Error("transaction unavailable"));
      else subject.current.resolve({ kind: "ready", value: kind === "missing" ? undefined : { ...transaction, aggregateVersion: 2 } });
      await expect(subject.commands.update({ ...command, patch: { categoryId: "food" } })).rejects.toBe(categoryError);
      expect(subject.repository.commit).not.toHaveBeenCalled();
    },
  );

  it("preserves version mismatch ahead of an unusable category after a successful lookup", async () => {
    const subject = fixture(async () => false);
    subject.receipt.resolve(undefined);
    subject.current.resolve({ kind: "ready", value: { ...transaction, aggregateVersion: 2 } });
    await expect(subject.commands.update({ ...command, patch: { categoryId: "food" } }))
      .resolves.toEqual({ kind: "conflict", code: "VERSION_MISMATCH", currentVersion: 2 });
    expect(subject.repository.commit).not.toHaveBeenCalled();
  });

  it.each([true, false])("waits for the async category policy when recording an expense: %s", async usable => {
    const category = deferred<boolean>();
    const subject = fixture(() => category.promise);
    subject.receipt.resolve(undefined);
    const pending = subject.commands.recordManualExpense({
      commandId: "record", actor: command.actor, merchant: "가맹점", amountInWon: 1000,
      categoryId: "food", accountingDate: "2026-09-07",
    });
    await Promise.resolve();
    expect(subject.repository.commit).not.toHaveBeenCalled();
    category.resolve(usable);
    await expect(pending).resolves.toMatchObject(usable
      ? { kind: "success", value: { categoryId: "food" } }
      : { kind: "validation-error", code: "CATEGORY_NOT_USABLE" });
    expect(subject.repository.commit).toHaveBeenCalledTimes(usable ? 1 : 0);
  });
});

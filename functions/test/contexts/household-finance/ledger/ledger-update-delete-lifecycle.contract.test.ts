import { describe, expect, it } from "vitest";
import { createLedgerUpdateDeleteFixtureSubject } from "../../../support/ledger-update-delete-fixture";

export interface MutableLedgerTransaction {
  transactionId: string;
  householdId: string;
  lifecycleState: "active" | "deleted";
  merchant: string;
  amountInWon: number;
  categoryId: string;
  memo: string;
  accountingDate: string;
  aggregateVersion: number;
}

export type LedgerUpdateDeleteResult =
  | { kind: "Updated"; transaction: MutableLedgerTransaction }
  | { kind: "Deleted"; transactionId: string; version: number }
  | { kind: "NotFound" }
  | { kind: "Forbidden" }
  | { kind: "Conflict"; code: "VERSION_MISMATCH"; currentVersion: number }
  | { kind: "ValidationError"; code: string }
  | { kind: "RetryableFailure"; code: string };

export interface LedgerUpdateDeleteSnapshot {
  transactions: readonly MutableLedgerTransaction[];
  events: readonly {
    eventName: "TransactionChanged.v1" | "TransactionDeleted.v1";
    transactionId: string;
    aggregateVersion: number;
  }[];
}

export interface LedgerUpdateDeleteContractSubject {
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
  snapshot(): LedgerUpdateDeleteSnapshot;
}

export function createSubject(fixture: {
  transactions: readonly MutableLedgerTransaction[];
  failNextCommit?: boolean;
}): LedgerUpdateDeleteContractSubject {
  return createLedgerUpdateDeleteFixtureSubject(fixture);
}

const actor = {
  householdId: "household-1",
  memberId: "member-1",
  canWriteLedger: true,
};

const original: MutableLedgerTransaction = {
  transactionId: "transaction-1",
  householdId: "household-1",
  lifecycleState: "active",
  merchant: "이전 가맹점",
  amountInWon: 10_000,
  categoryId: "category-before",
  memo: "이전 메모",
  accountingDate: "2026-07-01",
  aggregateVersion: 3,
};

describe("Ledger Update·Delete 전체 결과 공개 계약", () => {
  it("[T-LED-008][LED-005] Update 성공은 허용된 전체 필드를 한 version으로 확정하고 변경 Event를 남긴다", async () => {
    const subject = createSubject({ transactions: [original] });

    const result = await subject.update({
      actor,
      commandId: "update-all-fields",
      transactionId: "transaction-1",
      expectedVersion: 3,
      patch: {
        merchant: "새 가맹점",
        amountInWon: 25_000,
        categoryId: "category-after",
        memo: "새 메모",
        accountingDate: "2026-07-20",
      },
    });

    expect(result).toEqual({
      kind: "Updated",
      transaction: {
        ...original,
        merchant: "새 가맹점",
        amountInWon: 25_000,
        categoryId: "category-after",
        memo: "새 메모",
        accountingDate: "2026-07-20",
        aggregateVersion: 4,
      },
    });
    expect(subject.snapshot()).toEqual({
      transactions: [
        expect.objectContaining({
          transactionId: "transaction-1",
          aggregateVersion: 4,
        }),
      ],
      events: [
        {
          eventName: "TransactionChanged.v1",
          transactionId: "transaction-1",
          aggregateVersion: 4,
        },
      ],
    });
  });

  it("[T-LED-008][LED-005] Delete 성공은 거래를 deleted로 전이하고 삭제 Event와 새 version을 반환한다", async () => {
    const subject = createSubject({ transactions: [original] });

    expect(
      await subject.delete({
        actor,
        commandId: "delete-1",
        transactionId: "transaction-1",
        expectedVersion: 3,
      }),
    ).toEqual({ kind: "Deleted", transactionId: "transaction-1", version: 4 });
    expect(subject.snapshot()).toEqual({
      transactions: [
        { ...original, lifecycleState: "deleted", aggregateVersion: 4 },
      ],
      events: [
        {
          eventName: "TransactionDeleted.v1",
          transactionId: "transaction-1",
          aggregateVersion: 4,
        },
      ],
    });
  });

  it.each(["update", "delete"] as const)(
    "[T-LED-008][LED-005] 존재하지 않는 거래의 %s는 NotFound이며 상태와 Event가 바뀌지 않는다",
    async (operation) => {
      const subject = createSubject({ transactions: [original] });
      const common = {
        actor,
        commandId: `${operation}-missing`,
        transactionId: "missing",
        expectedVersion: 1,
      };

      const result =
        operation === "update"
          ? await subject.update({ ...common, patch: { merchant: "변경" } })
          : await subject.delete(common);

      expect(result).toEqual({ kind: "NotFound" });
      expect(subject.snapshot()).toEqual({
        transactions: [original],
        events: [],
      });
    },
  );

  it.each(["update", "delete"] as const)(
    "[T-LED-008][LED-005] stale version의 %s는 현재 version을 가진 Conflict이며 write가 없다",
    async (operation) => {
      const subject = createSubject({ transactions: [original] });
      const common = {
        actor,
        commandId: `${operation}-stale`,
        transactionId: "transaction-1",
        expectedVersion: 2,
      };

      const result =
        operation === "update"
          ? await subject.update({ ...common, patch: { merchant: "변경" } })
          : await subject.delete(common);

      expect(result).toEqual({
        kind: "Conflict",
        code: "VERSION_MISMATCH",
        currentVersion: 3,
      });
      expect(subject.snapshot()).toEqual({
        transactions: [original],
        events: [],
      });
    },
  );

  it("[T-LED-008][LED-005] 다른 가구의 거래 ID는 존재 여부를 노출하지 않고 NotFound로 끝낸다", async () => {
    const subject = createSubject({ transactions: [original] });

    expect(
      await subject.update({
        actor: { ...actor, householdId: "household-2" },
        commandId: "cross-household",
        transactionId: "transaction-1",
        expectedVersion: 3,
        patch: { merchant: "침범" },
      }),
    ).toEqual({ kind: "NotFound" });
    expect(subject.snapshot()).toEqual({ transactions: [original], events: [] });
  });
});

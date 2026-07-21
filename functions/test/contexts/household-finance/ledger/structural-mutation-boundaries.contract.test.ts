import { describe, expect, it } from "vitest";
import { createStructuralMutationBoundariesFixtureSubject } from "../../../support/structural-mutation-boundaries-fixture";

export type StructuralOperation =
  | "split-items"
  | "reconfigure-monthly"
  | "collapse-monthly"
  | "merge"
  | "unmerge"
  | "cancel-captured-lineage";

export interface StructuralLedgerState {
  transactions: readonly {
    transactionId: string;
    householdId: string;
    lifecycleState: "active" | "superseded";
    aggregateVersion: number;
  }[];
  claims: readonly {
    claimId: string;
    householdId: string;
    state: "active" | "cancelled";
    version: number;
  }[];
  receipts: readonly string[];
  events: readonly string[];
}

export type StructuralMutationResult =
  | { kind: "Committed"; changedTransactionIds: readonly string[] }
  | { kind: "Forbidden"; code: "LEDGER_WRITE_FORBIDDEN" }
  | { kind: "NotFound" }
  | {
      kind: "Conflict";
      code: "VERSION_MISMATCH" | "LINEAGE_VERSION_MISMATCH";
    }
  | { kind: "RetryableFailure"; code: "LEDGER_UOW_COMMIT_FAILED" };

export interface StructuralMutationBoundariesContractSubject {
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
  snapshot(): StructuralLedgerState;
}

export function createSubject(fixture: {
  state: StructuralLedgerState;
  failCommit?: boolean;
}): StructuralMutationBoundariesContractSubject {
  return createStructuralMutationBoundariesFixtureSubject(fixture);
}

const initialState: StructuralLedgerState = {
  transactions: [
    {
      transactionId: "transaction-a",
      householdId: "household-1",
      lifecycleState: "active",
      aggregateVersion: 3,
    },
    {
      transactionId: "transaction-b",
      householdId: "household-1",
      lifecycleState: "active",
      aggregateVersion: 5,
    },
  ],
  claims: [
    {
      claimId: "lineage-a",
      householdId: "household-1",
      state: "active",
      version: 2,
    },
  ],
  receipts: [],
  events: [],
};

const operations: readonly StructuralOperation[] = [
  "split-items",
  "reconfigure-monthly",
  "collapse-monthly",
  "merge",
  "unmerge",
  "cancel-captured-lineage",
];

function command(
  operation: StructuralOperation,
  overrides: Partial<
    Parameters<StructuralMutationBoundariesContractSubject["execute"]>[0]
  > = {},
) {
  return {
    operation,
    operationKey: `${operation}-operation`,
    actor: {
      householdId: "household-1",
      memberId: "member-1",
      canWriteLedger: true,
    },
    targetIds:
      operation === "cancel-captured-lineage"
        ? ["lineage-a"]
        : ["transaction-a", "transaction-b"],
    expectedVersions:
      operation === "cancel-captured-lineage"
        ? { "lineage-a": 2 }
        : { "transaction-a": 3, "transaction-b": 5 },
    ...overrides,
  };
}

describe("Ledger 구조 변경 공통 인가·version·UoW 공개 계약", () => {
  it.each(operations)(
    "[T-LED-002][LED-008] %s는 권한·tenant·존재·version을 commit 전에 검증한다",
    async (operation) => {
      const unauthorized = createSubject({ state: initialState });
      const crossHousehold = createSubject({ state: initialState });
      const missing = createSubject({ state: initialState });
      const stale = createSubject({ state: initialState });

      expect(
        await unauthorized.execute(
          command(operation, {
            actor: {
              householdId: "household-1",
              memberId: "member-1",
              canWriteLedger: false,
            },
          }),
        ),
      ).toEqual({ kind: "Forbidden", code: "LEDGER_WRITE_FORBIDDEN" });
      expect(
        await crossHousehold.execute(
          command(operation, {
            actor: {
              householdId: "household-2",
              memberId: "member-2",
              canWriteLedger: true,
            },
          }),
        ),
      ).toEqual({ kind: "NotFound" });
      expect(
        await missing.execute(
          command(operation, {
            targetIds: ["missing-target"],
            expectedVersions: { "missing-target": 1 },
          }),
        ),
      ).toEqual({ kind: "NotFound" });
      expect(
        await stale.execute(
          command(operation, {
            expectedVersions:
              operation === "cancel-captured-lineage"
                ? { "lineage-a": 1 }
                : { "transaction-a": 3, "transaction-b": 4 },
          }),
        ),
      ).toEqual({
        kind: "Conflict",
        code:
          operation === "cancel-captured-lineage"
            ? "LINEAGE_VERSION_MISMATCH"
            : "VERSION_MISMATCH",
      });

      for (const subject of [unauthorized, crossHousehold, missing, stale]) {
        expect(subject.snapshot()).toEqual(initialState);
      }
    },
  );

  it.each(operations)(
    "[T-LED-002][LED-008] %s의 UoW commit 실패는 본문·claim·receipt·Event를 전부 rollback한다",
    async (operation) => {
      const subject = createSubject({ state: initialState, failCommit: true });

      expect(await subject.execute(command(operation))).toEqual({
        kind: "RetryableFailure",
        code: "LEDGER_UOW_COMMIT_FAILED",
      });
      expect(subject.snapshot()).toEqual(initialState);
    },
  );
});

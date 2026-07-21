import { describe, expect, it } from "vitest";
import { createLocalCurrencyLedgerFixtureSubject } from "../../../support/local-currency-ledger-fixture";

type LifecycleState = "active" | "superseded" | "deleted";

interface LocalCurrencyLedgerRow {
  transactionId: string;
  householdId: string;
  lifecycleState: LifecycleState;
  amountInWon: number;
  localCurrencyType?: string;
  aggregateVersion: number;
}

interface LocalCurrencyLedgerState {
  transactions: readonly LocalCurrencyLedgerRow[];
}

type QueryResult =
  | { kind: "success"; transactionIds: readonly string[] }
  | { kind: "no-data" }
  | { kind: "validation-error"; code: string }
  | { kind: "retryable-failure"; code: string };

type MutationResult =
  | { kind: "success"; transactionIds: readonly string[] }
  | { kind: "conflict"; code: string }
  | { kind: "validation-error"; code: string };

export interface LocalCurrencyLedgerContractSubject {
  list(input: {
    householdId: string;
    localCurrencyType: string;
    period: { startDate: string; endDate: string };
  }): Promise<QueryResult>;
  split(input: {
    operationKey: string;
    sourceId: string;
    expectedVersion: number;
    amountsInWon: readonly number[];
  }): Promise<MutationResult>;
  merge(input: {
    operationKey: string;
    transactionIds: readonly string[];
    expectedVersions: Readonly<Record<string, number>>;
  }): Promise<MutationResult>;
  state(): LocalCurrencyLedgerState;
}

export function createSubject(fixture: {
  transactions: readonly LocalCurrencyLedgerRow[];
}): LocalCurrencyLedgerContractSubject {
  return createLocalCurrencyLedgerFixtureSubject(fixture);
}

const row = (
  transactionId: string,
  localCurrencyType?: string,
  overrides: Partial<LocalCurrencyLedgerRow> = {},
): LocalCurrencyLedgerRow => ({
  transactionId,
  householdId: "house-1",
  lifecycleState: "active",
  amountInWon: 10_000,
  localCurrencyType,
  aggregateVersion: 1,
  ...overrides,
});

describe("Ledger 지역화폐 유형 경계 계약", () => {
  it("[T-LED-004][LED-010][DEC-057] 선택한 한 지역화폐 유형의 active 거래만 상세 조회한다", async () => {
    const subject = createSubject({
      transactions: [
        row("gyeonggi", "gyeonggi"),
        row("daejeon", "daejeon"),
        row("legacy-untyped"),
        row("legacy-unknown", "legacy-unknown"),
        row("deleted-gyeonggi", "gyeonggi", { lifecycleState: "deleted" }),
        row("other-house", "gyeonggi", { householdId: "house-2" }),
      ],
    });

    const result = await subject.list({
      householdId: "house-1",
      localCurrencyType: "gyeonggi",
      period: { startDate: "2026-07-01", endDate: "2026-07-31" },
    });

    expect(result).toEqual({ kind: "success", transactionIds: ["gyeonggi"] });
  });

  it.each(["", "all", "legacy-unknown"])(
    "[T-LED-004][LED-010][DEC-057] 상세 유형 '%s'를 명시적인 실제 유형으로 받지 못하면 거부한다",
    async (localCurrencyType) => {
      const result = await createSubject({ transactions: [] }).list({
        householdId: "house-1",
        localCurrencyType,
        period: { startDate: "2026-07-01", endDate: "2026-07-31" },
      });

      expect(result).toEqual({
        kind: "validation-error",
        code: "LOCAL_CURRENCY_TYPE_REQUIRED",
      });
    },
  );

  it("[T-LED-004][LED-009][LED-010] 분할 파생 거래는 원본의 지역화폐 유형을 모두 보존한다", async () => {
    const subject = createSubject({ transactions: [row("source", "gyeonggi")] });

    const result = await subject.split({
      operationKey: "split-source",
      sourceId: "source",
      expectedVersion: 1,
      amountsInWon: [4_000, 6_000],
    });

    expect(result).toMatchObject({ kind: "success" });
    const state = subject.state();
    expect(
      state.transactions
        .filter(({ transactionId }) => transactionId !== "source")
        .map(({ localCurrencyType }) => localCurrencyType),
    ).toEqual(["gyeonggi", "gyeonggi"]);
  });

  it.each([
    [row("gyeonggi", "gyeonggi"), row("daejeon", "daejeon")],
    [row("typed", "gyeonggi"), row("untyped")],
  ])(
    "[T-LED-004][LED-009][LED-010] 서로 다른 유형 또는 typed/untyped 거래의 merge를 전체 거부한다",
    async (left, right) => {
      const subject = createSubject({ transactions: [left, right] });
      const before = subject.state();

      const result = await subject.merge({
        operationKey: `merge-${left.transactionId}-${right.transactionId}`,
        transactionIds: [left.transactionId, right.transactionId],
        expectedVersions: {
          [left.transactionId]: left.aggregateVersion,
          [right.transactionId]: right.aggregateVersion,
        },
      });

      expect(result).toEqual({
        kind: "conflict",
        code: "LOCAL_CURRENCY_TYPE_MISMATCH",
      });
      expect(subject.state()).toEqual(before);
    },
  );
});

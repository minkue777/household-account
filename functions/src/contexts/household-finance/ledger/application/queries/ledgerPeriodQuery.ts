import { selectLedgerRows, type LedgerReadItem } from "../../domain/policies/ledgerReadSelection";
import type { LedgerReadSource } from "../ports/out/ledgerReadSource";

export type LedgerPeriodQueryResult =
  | { kind: "Success"; items: readonly Omit<LedgerReadItem, "transactionType">[] }
  | { kind: "NoData" }
  | { kind: "RetryableFailure"; code: string };

export type CompatibleLedgerReadResult =
  | { kind: "success"; items: readonly LedgerReadItem[] }
  | { kind: "no-data" }
  | { kind: "contract-failure"; code: string }
  | { kind: "retryable-failure"; code: string };

export interface LedgerPeriodQuery {
  byMonth(input: {
    householdId: string;
    transactionType: "expense" | "income";
    yearMonth: string;
  }): Promise<LedgerPeriodQueryResult>;
  byPeriod(input: {
    householdId: string;
    transactionType: "expense" | "income";
    startDate: string;
    endDate: string;
  }): Promise<LedgerPeriodQueryResult>;
}

export interface CompatibleLedgerReader {
  list(input: {
    householdId: string;
    transactionType: "expense" | "income";
    period: { startDate: string; endDate: string };
  }): Promise<CompatibleLedgerReadResult>;
}

function monthPeriod(yearMonth: string): { startDate: string; endDate: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (match === null) throw new Error("YYYY-MM 형식이 필요합니다.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error("유효한 월이 필요합니다.");
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    startDate: `${yearMonth}-01`,
    endDate: `${yearMonth}-${String(endDay).padStart(2, "0")}`,
  };
}

async function canonicalQuery(
  source: LedgerReadSource,
  input: {
    householdId: string;
    transactionType: "expense" | "income";
    startDate: string;
    endDate: string;
  },
): Promise<LedgerPeriodQueryResult> {
  const loaded = await source.load();
  if (loaded.kind !== "success") {
    return { kind: "RetryableFailure", code: loaded.code };
  }
  const selected = selectLedgerRows({ rows: loaded.rows, ...input });
  if (selected.kind !== "success") {
    return { kind: "RetryableFailure", code: selected.code };
  }
  if (selected.items.length === 0) return { kind: "NoData" };

  return {
    kind: "Success",
    items: selected.items.map(({ transactionType: _transactionType, ...item }) =>
      item,
    ),
  };
}

export function createLedgerPeriodQuery(
  source: LedgerReadSource,
): LedgerPeriodQuery {
  return {
    byMonth: (input) =>
      canonicalQuery(source, { ...input, ...monthPeriod(input.yearMonth) }),
    byPeriod: (input) => canonicalQuery(source, input),
  };
}

export function createCompatibleLedgerReader(
  source: LedgerReadSource,
): CompatibleLedgerReader {
  return {
    list: async (input) => {
      const loaded = await source.load();
      if (loaded.kind !== "success") return loaded;

      const selected = selectLedgerRows({
        rows: loaded.rows,
        householdId: input.householdId,
        transactionType: input.transactionType,
        startDate: input.period.startDate,
        endDate: input.period.endDate,
      });
      if (selected.kind !== "success") return selected;
      return selected.items.length === 0
        ? { kind: "no-data" }
        : { kind: "success", items: selected.items };
    },
  };
}

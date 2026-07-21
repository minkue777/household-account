export type ReportingAssetType =
  | "stock"
  | "fund"
  | "crypto"
  | "property"
  | "loan";

export type AssetPeriodPreset =
  | "LAST_3_MONTHS"
  | "LAST_6_MONTHS"
  | "LAST_1_YEAR"
  | "ALL";

export interface AssetStatisticsPoint {
  date: string;
  valuesByType: Partial<Record<ReportingAssetType, number>>;
}

export type AssetStatisticsResult =
  | {
      kind: "success";
      period: { startDate: string; endDate: string };
      totals: ReadonlyArray<{ date: string; amountInWon: number }>;
    }
  | { kind: "no-data" };

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

const ASSET_TYPES: readonly ReportingAssetType[] = [
  "stock",
  "fund",
  "crypto",
  "property",
  "loan",
];

function parseLocalDate(value: string): LocalDateParts | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return undefined;
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const parsed = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return parsed.getUTCFullYear() === parts.year &&
    parsed.getUTCMonth() === parts.month - 1 &&
    parsed.getUTCDate() === parts.day
    ? parts
    : undefined;
}

function shiftMonth(
  value: Pick<LocalDateParts, "year" | "month">,
  amount: number,
): Pick<LocalDateParts, "year" | "month"> {
  const absolute = value.year * 12 + value.month - 1 + amount;
  return {
    year: Math.floor(absolute / 12),
    month: (absolute % 12) + 1,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function monthStart(value: Pick<LocalDateParts, "year" | "month">): string {
  return `${String(value.year).padStart(4, "0")}-${pad(value.month)}-01`;
}

function monthEnd(value: Pick<LocalDateParts, "year" | "month">): string {
  const day = new Date(Date.UTC(value.year, value.month, 0)).getUTCDate();
  return `${String(value.year).padStart(4, "0")}-${pad(value.month)}-${pad(day)}`;
}

export function queryAssetStatisticsPeriod(
  fixture: { today: string; snapshots: readonly AssetStatisticsPoint[] },
  input: { preset?: AssetPeriodPreset; financialOnly?: boolean } = {},
): AssetStatisticsResult {
  const today = parseLocalDate(fixture.today);
  if (today === undefined) throw new Error("유효한 오늘 LocalDate가 필요합니다.");

  const snapshots = fixture.snapshots
    .filter((snapshot) => parseLocalDate(snapshot.date) !== undefined)
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date));
  if (snapshots.length === 0) return { kind: "no-data" };

  const preset = input.preset ?? "LAST_3_MONTHS";
  const period =
    preset === "ALL"
      ? { startDate: snapshots[0].date, endDate: fixture.today }
      : (() => {
          const months =
            preset === "LAST_3_MONTHS"
              ? 3
              : preset === "LAST_6_MONTHS"
                ? 6
                : 12;
          return {
            startDate: monthStart(shiftMonth(today, -(months - 1))),
            endDate: monthEnd(today),
          };
        })();

  const includedTypes = input.financialOnly
    ? ASSET_TYPES.filter(
        (type) => type !== "property" && type !== "loan",
      )
    : ASSET_TYPES;
  const totals = snapshots
    .filter(
      (snapshot) =>
        snapshot.date >= period.startDate && snapshot.date <= period.endDate,
    )
    .map((snapshot) => ({
      date: snapshot.date,
      amountInWon: includedTypes.reduce(
        (sum, type) => sum + (snapshot.valuesByType[type] ?? 0),
        0,
      ),
    }));

  return totals.length === 0 ? { kind: "no-data" } : { kind: "success", period, totals };
}

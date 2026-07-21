export interface AssetHistoryPoint {
  localDate: string;
  amountInWon: number;
  source: "stored-snapshot" | "live-today";
}

export interface AssetHistoryQuery {
  period: { startDate: string; endDate: string };
  storedPoints: readonly AssetHistoryPoint[];
  liveToday?: AssetHistoryPoint;
}

export type AssetHistoryQueryResult =
  | { kind: "success"; points: readonly AssetHistoryPoint[] }
  | { kind: "no-data" };

function dateValue(localDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (match === null) throw new Error("YYYY-MM-DD 날짜가 필요합니다.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const value = Date.UTC(year, month - 1, day);
  const parsed = new Date(value);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("유효한 LocalDate가 필요합니다.");
  }
  return value;
}

function localDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function queryAssetHistory(
  input: AssetHistoryQuery,
): AssetHistoryQueryResult {
  const start = dateValue(input.period.startDate);
  const end = dateValue(input.period.endDate);
  if (start > end) throw new Error("조회 시작일은 종료일보다 늦을 수 없습니다.");

  const byDate = new Map<number, AssetHistoryPoint>();
  for (const point of input.storedPoints) {
    const date = dateValue(point.localDate);
    if (date <= end) byDate.set(date, { ...point });
  }
  if (input.liveToday !== undefined) {
    const date = dateValue(input.liveToday.localDate);
    if (date >= start && date <= end) {
      byDate.set(date, { ...input.liveToday, source: "live-today" });
    }
  }

  const orderedDates = [...byDate.keys()].sort((left, right) => left - right);
  let current = orderedDates
    .filter((date) => date <= start)
    .map((date) => byDate.get(date))
    .at(-1);
  const points: AssetHistoryPoint[] = [];

  for (let date = start; date <= end; date += 86_400_000) {
    const exact = byDate.get(date);
    if (exact !== undefined) current = exact;
    if (current === undefined) continue;

    points.push({
      localDate: localDate(date),
      amountInWon: current.amountInWon,
      source: current.source,
    });
  }

  return points.length === 0 ? { kind: "no-data" } : { kind: "success", points };
}

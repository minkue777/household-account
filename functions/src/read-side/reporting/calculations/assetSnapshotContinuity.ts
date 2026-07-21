import type {
  AssetSnapshotFact,
  AssetSnapshotSourceResult,
} from "../model/assetSnapshot";

export interface AssetStatisticsView {
  period: { startDate: string; endDate: string };
  points: ReadonlyArray<{ date: string; amountInWon: number }>;
  sourceCheckpoint: string;
}

export type AssetSnapshotContinuityResult =
  | { kind: "success"; value: AssetStatisticsView }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string };

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

export function calculateAssetSnapshotContinuity(input: {
  source: Extract<AssetSnapshotSourceResult, { kind: "ready" }>;
  period: { startDate: string; endDate: string };
}): AssetSnapshotContinuityResult {
  const start = dateValue(input.period.startDate);
  const end = dateValue(input.period.endDate);
  if (start > end) throw new Error("조회 시작일은 종료일보다 늦을 수 없습니다.");

  const window = new Map<number, AssetSnapshotFact>();
  for (const snapshot of input.source.window) {
    const date = dateValue(snapshot.snapshotDate);
    if (date >= start && date <= end) window.set(date, snapshot);
  }

  let current = input.source.baseline;
  const points: Array<{ date: string; amountInWon: number }> = [];
  for (let date = start; date <= end; date += 86_400_000) {
    const exact = window.get(date);
    if (exact !== undefined) current = exact;
    if (current === undefined) continue;
    points.push({ date: localDate(date), amountInWon: current.amountInWon });
  }

  if (points.length === 0) return { kind: "no-data" };
  return {
    kind: "success",
    value: {
      period: input.period,
      points,
      sourceCheckpoint: input.source.sourceCheckpoint,
    },
  };
}

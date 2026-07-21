import type {
  InstrumentSearchResult,
  SearchInstrument,
} from "../model/instrumentSearch";

const MAX_RESULT_COUNT = 10;

function normalizedLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return MAX_RESULT_COUNT;
  return Math.min(MAX_RESULT_COUNT, Math.max(1, Math.trunc(limit)));
}

function relevance(instrument: SearchInstrument, query: string): number | undefined {
  const normalize = (value: string) =>
    value.trim().toLocaleLowerCase().replace(/[\s\-_.():/]/gu, "");
  const normalizedQuery = normalize(query);
  const code = normalize(instrument.code);
  const name = normalize(instrument.name);
  const aliases = (instrument.aliases ?? []).map(normalize);

  if (code === normalizedQuery) return 0;
  if (code.startsWith(normalizedQuery)) return 1;
  if (name === normalizedQuery) return 2;
  if (name.startsWith(normalizedQuery)) return 3;
  if (name.includes(normalizedQuery)) return 4;
  if (aliases.some((alias) => alias === normalizedQuery)) return 5;
  if (aliases.some((alias) => alias.includes(normalizedQuery))) return 6;
  return undefined;
}

function identity(instrument: SearchInstrument): string {
  return `${instrument.market}:${instrument.code.toLocaleUpperCase()}`;
}

export function rankInstrumentSearch(
  instruments: readonly SearchInstrument[],
  rawQuery: string,
  limit?: number,
): InstrumentSearchResult {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (query.length === 0) {
    return { kind: "validation-error", code: "SEARCH_QUERY_REQUIRED" };
  }

  const unique = new Map<string, { instrument: SearchInstrument; relevance: number }>();
  for (const instrument of instruments) {
    const score = relevance(instrument, query);
    if (score === undefined) continue;

    const key = identity(instrument);
    const existing = unique.get(key);
    if (existing === undefined || score < existing.relevance) {
      unique.set(key, { instrument, relevance: score });
    }
  }

  const ranked = [...unique.values()].sort(
    (left, right) =>
      left.relevance - right.relevance ||
      left.instrument.market.localeCompare(right.instrument.market) ||
      left.instrument.code.localeCompare(right.instrument.code),
  );

  if (ranked.length === 0) return { kind: "no-data" };

  const resultLimit = normalizedLimit(limit);
  return {
    kind: "success",
    items: ranked.slice(0, resultLimit).map(({ instrument }) => instrument),
    truncated: ranked.length > resultLimit,
  };
}

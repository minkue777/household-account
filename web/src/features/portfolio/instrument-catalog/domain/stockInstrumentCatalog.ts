import type { StockSearchResult } from '@/types/asset';

export type StockCatalogMarket = 'KRX' | 'US' | 'KOFIA_FUND';
export type StockCatalogInstrumentType = 'STOCK' | 'ETF' | 'ETN' | 'FUND';

export interface StockCatalogInstrument {
  market: StockCatalogMarket;
  instrumentType: StockCatalogInstrumentType;
  code: string;
  name: string;
  aliases?: readonly string[];
  priceScale?: number;
}

export interface StockCatalogManifest {
  schemaVersion: 1;
  catalogVersion: string;
  snapshotObject: string;
  snapshotGeneration: string;
  asOfDate: string;
  publishedAt: string;
  sha256: string;
  itemCount: number;
}

export interface StockCatalogSnapshot {
  manifest: StockCatalogManifest;
  items: readonly StockCatalogInstrument[];
}

const MARKET_VALUES = new Set<StockCatalogMarket>([
  'KRX',
  'US',
  'KOFIA_FUND',
]);
const INSTRUMENT_TYPE_VALUES = new Set<StockCatalogInstrumentType>([
  'STOCK',
  'ETF',
  'ETN',
  'FUND',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInstrument(value: unknown): value is StockCatalogInstrument {
  if (!isRecord(value)) return false;
  if (
    !MARKET_VALUES.has(value.market as StockCatalogMarket) ||
    !INSTRUMENT_TYPE_VALUES.has(value.instrumentType as StockCatalogInstrumentType) ||
    typeof value.code !== 'string' ||
    value.code.trim() === '' ||
    typeof value.name !== 'string' ||
    value.name.trim() === ''
  ) {
    return false;
  }
  if (
    value.aliases !== undefined &&
    (!Array.isArray(value.aliases) ||
      value.aliases.some((alias) => typeof alias !== 'string'))
  ) {
    return false;
  }
  return (
    value.priceScale === undefined ||
    (typeof value.priceScale === 'number' &&
      Number.isFinite(value.priceScale) &&
      value.priceScale > 0)
  );
}

function isManifest(value: unknown): value is StockCatalogManifest {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === 1 &&
    typeof value.catalogVersion === 'string' &&
    value.catalogVersion !== '' &&
    typeof value.snapshotObject === 'string' &&
    /^market-catalog\/v1\/snapshots\/\d{4}-\d{2}-\d{2}\/v1\.json\.gz$/.test(
      value.snapshotObject
    ) &&
    typeof value.snapshotGeneration === 'string' &&
    value.snapshotGeneration !== '' &&
    typeof value.asOfDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.asOfDate) &&
    typeof value.publishedAt === 'string' &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    Number.isSafeInteger(value.itemCount) &&
    (value.itemCount as number) > 0
  );
}

export function parseStockCatalogManifest(value: unknown): StockCatalogManifest {
  if (!isManifest(value)) throw new Error('INSTRUMENT_CATALOG_MANIFEST_INVALID');
  return value;
}

export function parseStockCatalogSnapshot(value: unknown): StockCatalogSnapshot {
  if (!isRecord(value) || !isManifest(value.manifest) || !Array.isArray(value.items)) {
    throw new Error('INSTRUMENT_CATALOG_CACHE_INVALID');
  }
  if (
    value.items.length !== value.manifest.itemCount ||
    !value.items.every(isInstrument)
  ) {
    throw new Error('INSTRUMENT_CATALOG_CACHE_INVALID');
  }
  return {
    manifest: value.manifest,
    items: value.items,
  };
}

interface PreparedInstrument {
  readonly instrument: StockCatalogInstrument;
  readonly code: string;
  readonly name: string;
  readonly aliases: readonly string[];
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s\-_.():/]/g, '');
}

function relevance(instrument: PreparedInstrument, query: string): number | undefined {
  if (instrument.code === query) return 0;
  if (instrument.code.startsWith(query)) return 1;
  if (instrument.name === query) return 2;
  if (instrument.name.startsWith(query)) return 3;
  if (instrument.name.includes(query)) return 4;
  if (instrument.aliases.some((alias) => alias === query)) return 5;
  if (instrument.aliases.some((alias) => alias.includes(query))) return 6;
  return undefined;
}

function identity(instrument: StockCatalogInstrument): string {
  return `${instrument.market}:${instrument.code.toLocaleUpperCase()}`;
}

function toSearchResult(instrument: StockCatalogInstrument): StockSearchResult {
  const instrumentType =
    instrument.instrumentType === 'FUND'
      ? 'fund'
      : instrument.instrumentType === 'ETF'
        ? 'etf'
        : instrument.instrumentType === 'ETN'
          ? 'etn'
          : 'stock';
  return {
    market: instrument.market,
    instrumentType,
    code:
      instrument.market === 'US' && !instrument.code.startsWith('US:')
        ? `US:${instrument.code}`
        : instrument.code,
    name: instrument.name,
    ...(instrument.priceScale === undefined
      ? {}
      : { priceScale: instrument.priceScale }),
  };
}

export function prepareStockCatalog(
  instruments: readonly StockCatalogInstrument[]
): readonly PreparedInstrument[] {
  return instruments.map((instrument) => ({
    instrument,
    code: normalize(instrument.code),
    name: normalize(instrument.name),
    aliases: (instrument.aliases ?? []).map(normalize),
  }));
}

export function searchPreparedStockCatalog(
  prepared: readonly PreparedInstrument[],
  rawQuery: string,
  limit = 10
): StockSearchResult[] {
  const query = normalize(rawQuery);
  if (query === '') return [];

  const unique = new Map<
    string,
    { instrument: StockCatalogInstrument; relevance: number }
  >();
  for (const candidate of prepared) {
    const score = relevance(candidate, query);
    if (score === undefined) continue;
    const key = identity(candidate.instrument);
    const existing = unique.get(key);
    if (existing === undefined || score < existing.relevance) {
      unique.set(key, { instrument: candidate.instrument, relevance: score });
    }
  }

  return Array.from(unique.values())
    .sort(
      (left, right) =>
        left.relevance - right.relevance ||
        left.instrument.market.localeCompare(right.instrument.market) ||
        left.instrument.code.localeCompare(right.instrument.code)
    )
    .slice(0, Math.min(10, Math.max(1, Math.trunc(limit))))
    .map(({ instrument }) => toSearchResult(instrument));
}

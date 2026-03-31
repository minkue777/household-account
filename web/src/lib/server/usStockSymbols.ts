export interface UsStockSymbol {
  symbol: string;
  name: string;
  assetClass: 'stock' | 'etf';
  exchange: string;
}

interface CachedUsStockSymbols {
  fetchedAt: number;
  symbols: UsStockSymbol[];
  symbolMap: Map<string, UsStockSymbol>;
}

const CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const NASDAQ_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt';
const OTHER_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt';
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'text/plain,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

let cachedSymbols: CachedUsStockSymbols | null = null;

function normalizeLineBreaks(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function buildHeaderIndex(headerLine: string) {
  return headerLine
    .split('|')
    .reduce<Record<string, number>>((acc, header, index) => {
      acc[header.trim()] = index;
      return acc;
    }, {});
}

function getField(columns: string[], headerIndex: Record<string, number>, fieldName: string) {
  const fieldIndex = headerIndex[fieldName];
  return fieldIndex === undefined ? '' : (columns[fieldIndex] || '').trim();
}

function parseNasdaqListedRows(rawText: string): UsStockSymbol[] {
  const lines = normalizeLineBreaks(rawText)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headerIndex = buildHeaderIndex(lines[0]);

  return lines
    .slice(1)
    .filter((line) => !line.startsWith('File Creation Time'))
    .map((line) => line.split('|'))
    .filter((columns) => getField(columns, headerIndex, 'Test Issue') !== 'Y')
    .map((columns) => {
      const symbol = getField(columns, headerIndex, 'Symbol');
      const name = getField(columns, headerIndex, 'Security Name');
      const isEtf = getField(columns, headerIndex, 'ETF') === 'Y';

      if (!symbol || !name) {
        return null;
      }

      return {
        symbol,
        name,
        assetClass: isEtf ? 'etf' : 'stock',
        exchange: 'NASDAQ',
      } satisfies UsStockSymbol;
    })
    .filter((row): row is UsStockSymbol => row !== null);
}

function parseOtherListedRows(rawText: string): UsStockSymbol[] {
  const lines = normalizeLineBreaks(rawText)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headerIndex = buildHeaderIndex(lines[0]);

  return lines
    .slice(1)
    .filter((line) => !line.startsWith('File Creation Time'))
    .map((line) => line.split('|'))
    .filter((columns) => getField(columns, headerIndex, 'Test Issue') !== 'Y')
    .map((columns) => {
      const symbol =
        getField(columns, headerIndex, 'ACT Symbol') ||
        getField(columns, headerIndex, 'NASDAQ Symbol') ||
        getField(columns, headerIndex, 'CQS Symbol');
      const name = getField(columns, headerIndex, 'Security Name');
      const exchange = getField(columns, headerIndex, 'Exchange') || 'NYSE';
      const isEtf = getField(columns, headerIndex, 'ETF') === 'Y';

      if (!symbol || !name) {
        return null;
      }

      return {
        symbol,
        name,
        assetClass: isEtf ? 'etf' : 'stock',
        exchange,
      } satisfies UsStockSymbol;
    })
    .filter((row): row is UsStockSymbol => row !== null);
}

function dedupeSymbols(symbols: UsStockSymbol[]) {
  const symbolMap = new Map<string, UsStockSymbol>();

  for (const symbol of symbols) {
    const existing = symbolMap.get(symbol.symbol);
    if (!existing) {
      symbolMap.set(symbol.symbol, symbol);
      continue;
    }

    if (existing.assetClass !== 'etf' && symbol.assetClass === 'etf') {
      symbolMap.set(symbol.symbol, symbol);
    }
  }

  const deduped = Array.from(symbolMap.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  return { symbols: deduped, symbolMap };
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: REQUEST_HEADERS,
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch symbol list: ${url}`);
  }

  return response.text();
}

async function loadUsStockSymbols(): Promise<CachedUsStockSymbols> {
  if (cachedSymbols && Date.now() - cachedSymbols.fetchedAt < CACHE_TTL_MS) {
    return cachedSymbols;
  }

  const [nasdaqListedText, otherListedText] = await Promise.all([
    fetchText(NASDAQ_LISTED_URL),
    fetchText(OTHER_LISTED_URL),
  ]);

  const combined = [
    ...parseNasdaqListedRows(nasdaqListedText),
    ...parseOtherListedRows(otherListedText),
  ];

  const deduped = dedupeSymbols(combined);

  cachedSymbols = {
    fetchedAt: Date.now(),
    symbols: deduped.symbols,
    symbolMap: deduped.symbolMap,
  };

  return cachedSymbols;
}

export async function getUsStockSymbols(): Promise<UsStockSymbol[]> {
  const { symbols } = await loadUsStockSymbols();
  return symbols;
}

export async function getUsStockSymbol(symbol: string): Promise<UsStockSymbol | null> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedSymbol) {
    return null;
  }

  const { symbolMap } = await loadUsStockSymbols();
  return symbolMap.get(normalizedSymbol) || null;
}

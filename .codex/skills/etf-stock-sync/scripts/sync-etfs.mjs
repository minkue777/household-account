#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const NAVER_MARKET_API_BASE = 'https://m.stock.naver.com/api/stocks/marketValue';
const NAVER_ETF_API_URL =
  'https://finance.naver.com/api/sise/etfItemList.nhn?etfType=0&targetColumn=market_sum&sortOrder=desc';
const KRX_CORPORATION_LIST_URL =
  'https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13';
const NASDAQ_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt';
const OTHER_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt';
const STOCKS_JSON_PATH = path.join('web', 'src', 'data', 'stocks.json');
const PAGE_SIZE = 100;
const MIN_EXPECTED_COUNTS = {
  KOSPI: 2_000,
  KOSDAQ: 1_500,
  KONEX: 100,
  ETF: 1_000,
  US_NASDAQ: 4_000,
  US_OTHER: 5_000,
  US_TOTAL: 9_000,
};
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 household-account-stock-sync',
};

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const repoRoot = process.cwd();
const stocksPath = path.join(repoRoot, STOCKS_JSON_PATH);

function usage() {
  console.log(`Usage: node .codex/skills/etf-stock-sync/scripts/sync-etfs.mjs [--check]

Synchronizes the Korean stock search catalog and verifies the live US symbol providers.

Options:
  --check   Do not write. Exit 1 if stocks.json is not synchronized.`);
}

if (args.has('--help') || args.has('-h')) {
  usage();
  process.exit(0);
}

for (const arg of args) {
  if (arg !== '--check' && arg !== '--help' && arg !== '-h') {
    console.error(`Unknown argument: ${arg}`);
    usage();
    process.exit(2);
  }
}

async function fetchBuffer(url, extraHeaders = {}) {
  const response = await fetch(url, {
    headers: { ...REQUEST_HEADERS, ...extraHeaders },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} (${url})`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function fetchJson(url, extraHeaders = {}) {
  const buffer = await fetchBuffer(url, extraHeaders);
  return JSON.parse(buffer.toString('utf8'));
}

async function fetchNaverMarket(market) {
  const getPage = (page) =>
    fetchJson(`${NAVER_MARKET_API_BASE}/${market}?page=${page}&pageSize=${PAGE_SIZE}`);
  const first = await getPage(1);
  const totalCount = Number(first.totalCount);
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  if (!Number.isInteger(totalCount) || totalCount < MIN_EXPECTED_COUNTS[market]) {
    throw new Error(`Unexpected ${market} totalCount: ${first.totalCount}`);
  }

  const pages = [first];
  for (let page = 2; page <= totalPages; page += 6) {
    const requests = [];
    for (let current = page; current < Math.min(page + 6, totalPages + 1); current += 1) {
      requests.push(getPage(current));
    }
    pages.push(...(await Promise.all(requests)));
  }

  const rows = pages.flatMap((payload) => payload.stocks || []);
  if (rows.length !== totalCount) {
    throw new Error(`Incomplete ${market} list: expected ${totalCount}, received ${rows.length}`);
  }

  return rows.map((row) => {
    const code = String(row.itemCode || '').trim();
    const name = String(row.stockName || '').trim();
    if (!code || !name) {
      throw new Error(`Invalid ${market} row: ${JSON.stringify(row)}`);
    }
    return { code, name, market, assetClass: String(row.stockEndType || 'stock') };
  });
}

function decodeHtmlText(value) {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_match, valueInHex) =>
      String.fromCodePoint(Number.parseInt(valueInHex, 16))
    )
    .replace(/&#([0-9]+);/g, (_match, valueInDecimal) =>
      String.fromCodePoint(Number.parseInt(valueInDecimal, 10))
    )
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchKonexStocks() {
  const buffer = await fetchBuffer(KRX_CORPORATION_LIST_URL);
  const html = new TextDecoder('euc-kr').decode(buffer);
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .slice(1)
    .map((rowMatch) =>
      [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cellMatch) =>
        decodeHtmlText(cellMatch[1])
      )
    )
    .filter((cells) => cells.length >= 3 && cells[1] === '코넥스')
    .map((cells) => ({
      code: cells[2],
      name: cells[0],
      market: 'KONEX',
      assetClass: 'stock',
    }));
  const uniqueRows = [...new Map(rows.map((row) => [row.code, row])).values()];

  if (uniqueRows.length < MIN_EXPECTED_COUNTS.KONEX) {
    throw new Error(`Unexpected KONEX list size: ${uniqueRows.length}`);
  }

  return uniqueRows;
}

async function fetchEtfs() {
  const buffer = await fetchBuffer(NAVER_ETF_API_URL, {
    Referer: 'https://finance.naver.com/sise/etf.naver',
  });
  const text = new TextDecoder('euc-kr').decode(buffer);
  const payload = JSON.parse(text);
  const rows = payload?.result?.etfItemList;

  if (!Array.isArray(rows) || rows.length < MIN_EXPECTED_COUNTS.ETF) {
    throw new Error(`Unexpected ETF list size: ${Array.isArray(rows) ? rows.length : 'not an array'}`);
  }

  return rows.map((row) => ({ code: String(row.itemcode), name: String(row.itemname) }));
}

function normalizeLineBreaks(value) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function buildHeaderIndex(headerLine) {
  return headerLine.split('|').reduce((index, header, position) => {
    index[header.trim()] = position;
    return index;
  }, {});
}

function getField(columns, headerIndex, fieldName) {
  const position = headerIndex[fieldName];
  return position === undefined ? '' : String(columns[position] || '').trim();
}

function parseUsSymbolFile(rawText, kind) {
  const lines = normalizeLineBreaks(rawText)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const headerIndex = buildHeaderIndex(lines[0] || '');

  return lines
    .slice(1)
    .filter((line) => !line.startsWith('File Creation Time'))
    .map((line) => line.split('|'))
    .filter((columns) => getField(columns, headerIndex, 'Test Issue') !== 'Y')
    .map((columns) => {
      const symbol =
        kind === 'nasdaq'
          ? getField(columns, headerIndex, 'Symbol')
          : getField(columns, headerIndex, 'ACT Symbol') ||
            getField(columns, headerIndex, 'NASDAQ Symbol') ||
            getField(columns, headerIndex, 'CQS Symbol');
      const name = getField(columns, headerIndex, 'Security Name');
      return symbol && name ? { symbol, name } : null;
    })
    .filter(Boolean);
}

async function verifyUsSymbols() {
  const [nasdaqBuffer, otherBuffer] = await Promise.all([
    fetchBuffer(NASDAQ_LISTED_URL),
    fetchBuffer(OTHER_LISTED_URL),
  ]);
  const nasdaq = parseUsSymbolFile(nasdaqBuffer.toString('utf8'), 'nasdaq');
  const other = parseUsSymbolFile(otherBuffer.toString('utf8'), 'other');
  const unique = new Map([...nasdaq, ...other].map((row) => [row.symbol, row]));

  if (nasdaq.length < MIN_EXPECTED_COUNTS.US_NASDAQ) {
    throw new Error(`Unexpected NASDAQ symbol count: ${nasdaq.length}`);
  }
  if (other.length < MIN_EXPECTED_COUNTS.US_OTHER) {
    throw new Error(`Unexpected other-listed symbol count: ${other.length}`);
  }
  if (unique.size < MIN_EXPECTED_COUNTS.US_TOTAL) {
    throw new Error(`Unexpected unique US symbol count: ${unique.size}`);
  }

  return { nasdaq: nasdaq.length, other: other.length, unique: unique.size };
}

function loadStocks() {
  if (!fs.existsSync(stocksPath)) {
    throw new Error(`Cannot find ${STOCKS_JSON_PATH}. Run this script from the repository root.`);
  }
  const data = JSON.parse(fs.readFileSync(stocksPath, 'utf8'));
  if (!data || !Array.isArray(data.stocks)) {
    throw new Error(`${STOCKS_JSON_PATH} must contain a top-level "stocks" array.`);
  }
  return data;
}

function buildDomesticSnapshot(kospi, kosdaq, konex, etfs) {
  const byCode = new Map();
  for (const row of [...kospi, ...kosdaq, ...konex]) {
    if (byCode.has(row.code)) {
      throw new Error(`Duplicate domestic code from source: ${row.code}`);
    }
    byCode.set(row.code, { code: row.code, name: row.name });
  }

  const missingEtfs = etfs.filter((etf) => !byCode.has(etf.code));
  const mismatchedEtfs = etfs.filter(
    (etf) => byCode.has(etf.code) && byCode.get(etf.code).name !== etf.name
  );
  if (missingEtfs.length || mismatchedEtfs.length) {
    throw new Error(
      `Market/ETF source mismatch: missing=${missingEtfs.length}, renamed=${mismatchedEtfs.length}`
    );
  }

  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

function findDelta(data, snapshot) {
  const current = data.stocks.filter((stock) => !stock.code.startsWith('KRXGOLD'));
  const currentByCode = new Map(current.map((stock) => [stock.code, stock]));
  const snapshotByCode = new Map(snapshot.map((stock) => [stock.code, stock]));
  const added = snapshot.filter((stock) => !currentByCode.has(stock.code));
  const renamed = snapshot
    .filter(
      (stock) =>
        currentByCode.has(stock.code) && currentByCode.get(stock.code).name !== stock.name
    )
    .map((stock) => ({
      code: stock.code,
      from: currentByCode.get(stock.code).name,
      to: stock.name,
    }));
  const removed = current.filter((stock) => !snapshotByCode.has(stock.code));
  return { added, renamed, removed };
}

function applySnapshot(data, snapshot) {
  const gold = data.stocks.filter((stock) => stock.code.startsWith('KRXGOLD'));
  data.stocks = [...gold, ...snapshot];
}

function printList(title, items, formatter) {
  console.log(`${title}: ${items.length}`);
  for (const item of items) {
    console.log(`  ${formatter(item)}`);
  }
}

const data = loadStocks();
const [kospi, kosdaq, konex, etfs, us] = await Promise.all([
  fetchNaverMarket('KOSPI'),
  fetchNaverMarket('KOSDAQ'),
  fetchKonexStocks(),
  fetchEtfs(),
  verifyUsSymbols(),
]);
const snapshot = buildDomesticSnapshot(kospi, kosdaq, konex, etfs);
const delta = findDelta(data, snapshot);

console.log(
  `domestic source: ${snapshot.length} (KOSPI ${kospi.length}, KOSDAQ ${kosdaq.length}, KONEX ${konex.length}, ETF check ${etfs.length})`
);
console.log(`US live source: ${us.unique} unique (NASDAQ ${us.nasdaq}, other listed ${us.other})`);
printList('added', delta.added, (item) => `${item.code} ${item.name}`);
printList('renamed', delta.renamed, (item) => `${item.code} ${item.from} -> ${item.to}`);
printList('removed', delta.removed, (item) => `${item.code} ${item.name}`);

if (checkOnly) {
  process.exitCode =
    delta.added.length || delta.renamed.length || delta.removed.length ? 1 : 0;
} else {
  applySnapshot(data, snapshot);
  fs.writeFileSync(stocksPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`stocks total: ${data.stocks.length}`);
}

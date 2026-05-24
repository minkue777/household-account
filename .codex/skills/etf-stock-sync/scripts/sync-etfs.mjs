#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ETF_API_URL =
  'https://finance.naver.com/api/sise/etfItemList.nhn?etfType=0&targetColumn=market_sum&sortOrder=desc';
const STOCKS_JSON_PATH = path.join('web', 'src', 'data', 'stocks.json');
const MIN_EXPECTED_ETF_COUNT = 1000;

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const repoRoot = process.cwd();
const stocksPath = path.join(repoRoot, STOCKS_JSON_PATH);

function usage() {
  console.log(`Usage: node .codex/skills/etf-stock-sync/scripts/sync-etfs.mjs [--check]

Fetches the current Korean ETF list from Naver Finance and syncs ${STOCKS_JSON_PATH}.

Options:
  --check   Do not write. Exit 1 if stocks.json is not already synchronized.`);
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

async function fetchEtfs() {
  const response = await fetch(ETF_API_URL, {
    headers: {
      Referer: 'https://finance.naver.com/sise/etf.naver',
      'User-Agent': 'Mozilla/5.0 household-account-etf-sync',
    },
  });

  if (!response.ok) {
    throw new Error(`Naver ETF API failed: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const text = new TextDecoder('euc-kr').decode(buffer);
  const payload = JSON.parse(text);
  const etfItemList = payload?.result?.etfItemList;

  if (!Array.isArray(etfItemList) || etfItemList.length < MIN_EXPECTED_ETF_COUNT) {
    throw new Error(`Unexpected ETF list size: ${Array.isArray(etfItemList) ? etfItemList.length : 'not an array'}`);
  }

  return etfItemList.map((item) => ({
    code: String(item.itemcode),
    name: String(item.itemname),
  }));
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

function syncStocks(data, etfs) {
  const byCode = new Map(data.stocks.map((stock) => [stock.code, stock]));
  const added = [];
  const renamed = [];

  for (const etf of etfs) {
    const stock = byCode.get(etf.code);

    if (!stock) {
      data.stocks.push({ code: etf.code, name: etf.name });
      byCode.set(etf.code, etf);
      added.push(etf);
      continue;
    }

    if (stock.name !== etf.name) {
      renamed.push({ code: etf.code, from: stock.name, to: etf.name });
      stock.name = etf.name;
    }
  }

  const gold = data.stocks.filter((stock) => stock.code.startsWith('KRXGOLD'));
  const rest = data.stocks
    .filter((stock) => !stock.code.startsWith('KRXGOLD'))
    .sort((a, b) => a.code.localeCompare(b.code));
  data.stocks = [...gold, ...rest];

  return { added, renamed };
}

function findDelta(data, etfs) {
  const byCode = new Map(data.stocks.map((stock) => [stock.code, stock.name]));
  const missing = etfs.filter((etf) => !byCode.has(etf.code));
  const renamed = etfs
    .filter((etf) => byCode.has(etf.code) && byCode.get(etf.code) !== etf.name)
    .map((etf) => ({ code: etf.code, from: byCode.get(etf.code), to: etf.name }));

  return { missing, renamed };
}

function printList(title, items, formatter) {
  console.log(`${title}: ${items.length}`);

  for (const item of items) {
    console.log(`  ${formatter(item)}`);
  }
}

const data = loadStocks();
const etfs = await fetchEtfs();
const before = findDelta(data, etfs);

if (checkOnly) {
  console.log(`naver ETF count: ${etfs.length}`);
  printList('missing', before.missing, (item) => `${item.code} ${item.name}`);
  printList('renamed', before.renamed, (item) => `${item.code} ${item.from} -> ${item.to}`);
  process.exitCode = before.missing.length || before.renamed.length ? 1 : 0;
} else {
  const { added, renamed } = syncStocks(data, etfs);
  fs.writeFileSync(stocksPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

  console.log(`naver ETF count: ${etfs.length}`);
  console.log(`stocks total: ${data.stocks.length}`);
  printList('added', added, (item) => `${item.code} ${item.name}`);
  printList('renamed', renamed, (item) => `${item.code} ${item.from} -> ${item.to}`);
}

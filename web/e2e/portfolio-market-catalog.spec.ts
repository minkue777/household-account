import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createHouseholdThroughUi, resetTestAccount } from './emulator';
import { addAssetUi, modal } from './portfolio-helpers';
import { createInstrumentCatalogSourceFixture, newlyListedEtfs } from '../../functions/test/support/instrument-catalog-source-fixture';
import type { StockCatalogInstrument } from '../src/features/portfolio/instrument-catalog/domain/stockInstrumentCatalog';

async function loadProviderCatalog(): Promise<StockCatalogInstrument[]> {
  const { RemoteInstrumentCatalogRunSource } = require('../../functions/lib/adapters/firebase/portfolio/firebaseInstrumentCatalog.js');
  const fixture = createInstrumentCatalogSourceFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  try {
    const source = new RemoteInstrumentCatalogRunSource({ file: () => ({ exists: async () => [false] }) });
    const run = await source.load('2026-09-16');
    expect(run.domesticSource.kind).toBe('success');
    expect(run.usSource.kind).toBe('success');
    return [...run.domesticSource.items, ...run.usSource.items].map((item: StockCatalogInstrument) =>
      item.code === '005930' ? { ...item, aliases: ['삼전'] } : item);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test.beforeEach(async () => { await resetTestAccount(); });

test('[MARKET-001][MARKET-003][MARKET-005] 실제 Storage SDK·gzip·checksum·IndexedDB 경계를 거친 국내/미국 종목을 로컬 검색한다', async ({ page }) => {
  // Raw provider responses go through the production server adapter first.
  const items = await loadProviderCatalog();
  const body = gzipSync(Buffer.from(JSON.stringify({ schemaVersion: 1, asOfDate: '2026-09-01', catalogVersion: 'e2e-v1', itemCount: items.length, items })));
  const objectName = 'market-catalog/v1/snapshots/2026-09-01/v1.json.gz';
  const manifest = { schemaVersion: 1, catalogVersion: 'e2e-v1', snapshotObject: objectName, snapshotGeneration: '1001', asOfDate: '2026-09-01', publishedAt: '2026-09-01T06:00:00+09:00', sha256: createHash('sha256').update(body).digest('hex'), itemCount: items.length };
  let storageReads = 0;
  let failRemote = false;
  // 외부 Cloud Storage HTTP 응답만 synthetic catalog로 대체합니다.
  // 앱의 Storage SDK, manifest/generation/checksum/schema 검증과 IndexedDB 저장은 실제 코드입니다.
  await page.route('https://firebasestorage.googleapis.com/**', async route => {
    const url = new URL(route.request().url());
    if (!decodeURIComponent(url.pathname).includes('market-catalog/')) throw new Error('Unexpected external Storage path');
    storageReads += 1;
    if (failRemote) { await route.fulfill({ status: 403, json: { error: { code: 403, message: 'synthetic storage outage' } } }); return; }
    if (decodeURIComponent(url.pathname).endsWith('latest.json')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifest), headers: { 'access-control-allow-origin': '*' } });
    } else if (url.searchParams.get('alt') === 'media') {
      await route.fulfill({ status: 200, contentType: 'application/octet-stream', body, headers: { 'access-control-allow-origin': '*' } });
    } else {
      await route.fulfill({ status: 200, json: { name: objectName, bucket: 'e2e-catalog', generation: '1001', size: String(body.length), contentType: 'application/gzip', type: 'file' }, headers: { 'access-control-allow-origin': '*' } });
    }
  });
  await createHouseholdThroughUi(page);
  expect(storageReads).toBe(0);
  await page.goto('/assets');
  await expect(page.getByText('등록된 자산이 없습니다.', { exact: true })).toBeVisible();
  await addAssetUi(page, { name: '검색계좌', type: '주식' });
  await page.locator('[data-asset-id]').filter({ hasText: '검색계좌' }).click();
  const detail = modal(page, '검색계좌');
  const queries: unknown[] = [];
  page.on('request', request => {
    if (request.url().endsWith('/executeHouseholdQuery')) queries.push(request.postDataJSON());
  });
  await detail.getByPlaceholder('종목명 입력').fill('삼전');
  await expect(detail.getByRole('button', { name: /삼성전자/ })).toBeVisible();
  await detail.getByPlaceholder('종목명 입력').fill('SPY');
  await expect(detail.getByRole('button', { name: /SPDR S&P 500 ETF Trust/ })).toBeVisible();
  for (const item of newlyListedEtfs) {
    await detail.getByPlaceholder('종목명 입력').fill(item.code);
    await expect(detail.getByRole('button', { name: new RegExp(item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeVisible();
  }
  const cachedItems = await page.evaluate(() => new Promise<StockCatalogInstrument[]>((resolve, reject) => {
    const open = indexedDB.open('household-account-reference-data');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const read = database.transaction('instrument-catalog', 'readonly').objectStore('instrument-catalog').get('latest-v1');
      read.onerror = () => { database.close(); reject(read.error); };
      read.onsuccess = () => { database.close(); resolve(read.result.snapshot.items); };
    };
  }));
  for (const item of newlyListedEtfs) {
    expect(cachedItems.find(({ code }) => code === item.code)).toMatchObject({ ...item, instrumentType: 'ETF' });
  }
  expect(cachedItems.some(({ code }) => code === '777777' || code === '0203K0')).toBe(false);
  await detail.getByPlaceholder('종목명 입력').fill('E2E 지수');
  await expect(detail.getByRole('button', { name: /E2E 지수 ETF/ })).toHaveCount(10);
  expect(storageReads).toBeGreaterThanOrEqual(3);
  expect(queries).toEqual([]);
  await detail.getByRole('button', { name: '닫기', exact: true }).click();
  failRemote = true;
  await page.reload();
  await page.locator('[data-asset-id]').filter({ hasText: '검색계좌' }).click();
  await detail.getByPlaceholder('종목명 입력').fill('삼전');
  await expect(detail.getByRole('button', { name: /삼성전자/ })).toBeVisible();
});

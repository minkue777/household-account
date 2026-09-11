import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createHouseholdThroughUi, resetTestAccount } from './emulator';
import { addAssetUi, modal } from './portfolio-helpers';

test.beforeEach(async () => { await resetTestAccount(); });

test('[MARKET-001][MARKET-003][MARKET-005] 실제 Storage SDK·gzip·checksum·IndexedDB 경계를 거친 국내/미국 종목을 로컬 검색한다', async ({ page }) => {
  const items = [
    { market: 'KRX', instrumentType: 'STOCK', code: '005930', name: '삼성전자', aliases: ['삼전'] },
    { market: 'US', instrumentType: 'ETF', code: 'SPY', name: 'SPDR S&P 500 ETF Trust' },
    ...Array.from({ length: 14 }, (_, i) => ({ market: 'KRX', instrumentType: 'ETF', code: `9000${String(i).padStart(2, '0')}`, name: `E2E 지수 ETF ${i}` })),
  ];
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

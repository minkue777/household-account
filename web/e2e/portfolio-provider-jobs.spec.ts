import { expect, test } from '@playwright/test';
import { createHouseholdThroughUi, executeHouseholdCommand, resetTestAccount } from './emulator';
import { documents, runScheduled, type ProviderHttpFixture } from './portfolio-helpers';

test.beforeEach(async () => { await resetTestAccount(); });

test('[T-MARKET-003][T-GOLD-002][T-JOB-AST-001][T-JOB-AST-002][T-EXT-004][MARKET-002][MARKET-004][MARKET-006][FUND-001][GOLD-001][GOLD-002][EXT-001][EXT-003] 실제 시세 Scheduler가 시장별 HTTP를 파싱·환산하고 공급자 장애 때 마지막 성공 평가를 유지한다', async ({ page, request }) => {
  const scope = await createHouseholdThroughUi(page);
  const targets = [
    { name: '국내 주식', code: '005930', market: 'KRX', quantity: 3, expected: 3_000 },
    { name: '미국 주식', code: 'AAPL', market: 'US', quantity: 2, expected: 28_000 },
    { name: '국민성장펀드', code: 'EW001', market: 'KOFIA_FUND', quantity: 2_500, expected: 3_000, instrumentType: 'fund', priceScale: 1_000 },
    { name: 'KRX 금현물', code: 'KRXGOLD1KG', market: 'KRX', quantity: 3, expected: 300_000 },
  ];
  const created: { id: string; expected: number }[] = [];
  for (const target of targets) {
    const asset = await executeHouseholdCommand<{ assetId: string }>(request, { ...scope, command: 'portfolio.create-asset.v1', payload: { asset: { name: target.name, type: 'stock', owner: '가구', ownerRef: { kind: 'household' }, currentBalance: 0, currency: 'KRW', order: created.length, isActive: true } } });
    await executeHouseholdCommand(request, { ...scope, command: 'portfolio.add-position.v1', payload: { assetId: asset.assetId, positionKind: 'stock', expectedAssetVersion: 1, position: { assetId: asset.assetId, stockCode: target.code, stockName: target.name, market: target.market, holdingType: 'stock', instrumentType: target.instrumentType ?? 'stock', priceScale: target.priceScale ?? 1, quantity: target.quantity, avgPrice: 900, currentPrice: 900 } } });
    created.push({ id: asset.assetId, expected: target.expected });
  }
  const gold = await executeHouseholdCommand<{ assetId: string }>(request, { ...scope, command: 'portfolio.create-asset.v1', payload: { asset: { name: '실물 금', type: 'gold', subType: '실물', owner: '가구', ownerRef: { kind: 'household' }, quantity: 2, currentBalance: 0, currency: 'KRW', order: 5, isActive: true } } });
  created.push({ id: gold.assetId, expected: 750_000 });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const fixtures: ProviderHttpFixture[] = [
    { urlIncludes: '/api/stock/005930', body: JSON.stringify({ closePrice: '1,000' }) },
    { urlIncludes: 'api.nasdaq.com/api/quote/AAPL', body: JSON.stringify({ data: { primaryData: { lastSalePrice: '$10.00' } } }) },
    { urlIncludes: 'api.frankfurter.dev/v2/rate/USD/KRW', body: JSON.stringify({ base: 'USD', quote: 'KRW', rate: 1_400, date: today }) },
    { urlIncludes: 'investments.miraeasset.com/magi/fund/basePrices.do', body: `<table><tr><td>${today}</td><td>1,200.00</td></tr><tr><td>2099-01-01</td><td>9,999</td></tr></table>`, headers: { 'content-type': 'text/html' } },
    { urlIncludes: '/marketindex/metals/M04020000', body: '<strong>국내 금</strong><strong>100,000<span>원/g</span></strong>', headers: { 'content-type': 'text/html' } },
  ];
  const urls = await runScheduled('assetValuationDaily', `${today}T23:55:00+09:00`, fixtures);
  expect(urls.some(url => url.includes('api.nasdaq.com/api/quote/AAPL'))).toBe(true);
  expect(urls.some(url => url.includes('api.frankfurter.dev/v2/rate/USD/KRW'))).toBe(true);
  expect(urls.some(url => url.includes('fundCd=539502'))).toBe(true);
  expect(urls.some(url => /api\/stock\/(AAPL|KRXGOLD)/.test(url))).toBe(false);
  for (const asset of created) expect((await documents(request, 'assets')).find(x => x.id === asset.id)?.currentBalance).toBe(asset.expected);
  const balances = (await documents(request, 'assets')).map(x => ({ id: x.id, currentBalance: x.currentBalance }));
  const next = new Date(`${today}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  const failures = fixtures.map(item => ({ ...item, status: 503, body: '{}' }));
  await expect(runScheduled('assetValuationDaily', `${next.toISOString().slice(0, 10)}T23:55:00+09:00`, failures)).rejects.toThrow();
  expect((await documents(request, 'assets')).map(x => ({ id: x.id, currentBalance: x.currentBalance }))).toEqual(balances);
  // 정상 결과는 실제 Firestore SDK를 거쳐 통계 화면에도 나타납니다.
  await page.goto('/assets/stats');
  await expect(page.getByText(/^1,084,000\s*원$/)).toBeVisible();
});

test('[T-DIV-002][JOB-DIV-002][DIV-001][DIV-002][DIV-006] 실제 KIND 공시 수집은 활성 국내 ETF를 처리하고 미국 종목을 배당 대상으로 섞지 않는다', async ({ page, request }) => {
  const scope = await createHouseholdThroughUi(page);
  for (const target of [{ code: '069500', name: 'E2E 국내 ETF', market: 'KRX', instrumentType: 'etf' }, { code: 'SPY', name: '미국 ETF', market: 'US', instrumentType: 'etf' }]) {
    const asset = await executeHouseholdCommand<{ assetId: string }>(request, { ...scope, command: 'portfolio.create-asset.v1', payload: { asset: { name: target.name, type: 'stock', owner: '가구', ownerRef: { kind: 'household' }, currentBalance: 0, currency: 'KRW', order: 1, isActive: true } } });
    await executeHouseholdCommand(request, { ...scope, command: 'portfolio.add-position.v1', payload: { assetId: asset.assetId, positionKind: 'stock', expectedAssetVersion: 1, position: { assetId: asset.assetId, stockCode: target.code, stockName: target.name, market: target.market, instrumentType: target.instrumentType, holdingType: 'stock', quantity: 2, avgPrice: 1_000, currentPrice: 1_000 } } });
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const row = (name: string, number: string) => `<tr><td class="txc">${today}</td><td><a onclick="etfisusummary_open('A')" title="${name}">${name}</a></td><td><a onclick="openDisclsViewer('${number}','')" title="ETF이익금분배신고(분배금안내)">공시</a></td></tr>`;
  const http: ProviderHttpFixture[] = [
    { urlIncludes: 'disclosurebystocktype.do', body: `<em>2</em><table>${row('E2E 국내 ETF', '20260911000001')}${row('미국 ETF', '20260911000002')}</table>` },
    { urlIncludes: 'method=search&acptno=20260911000001', body: "<select><option value='DOC-E2E-KRX|Y'>문서</option></select>" },
    { urlIncludes: 'method=searchContents', body: "setPath('','https://kind.krx.co.kr/external/68659.htm')" },
    { urlIncludes: '/external/68659.htm', body: `<table><tr><td><span>069500</span></td><td><span>E2E 국내 ETF</span></td><td><span>${today}</span></td><td><span>${tomorrow}</span></td><td><span>120원</span></td></tr></table>` },
  ];
  const urls = await runScheduled('dividendHourly', `${today}T10:00:00+09:00`, http);
  expect(urls.filter(url => url.includes('disclosurebystocktype.do'))).toHaveLength(1);
  expect(urls.some(url => url.includes('20260911000002'))).toBe(false);
  const events = await documents(request, 'dividend_events');
  expect(events, JSON.stringify({ urls, observations: await documents(request, 'operations/runtime/providerObservations') })).toHaveLength(1);
  expect(events[0]).toMatchObject({ stockCode: '069500', status: 'fixed', eligibleQuantity: 2, totalAmount: 240, sourceDisclosureId: 'DOC-E2E-KRX' });
  await page.goto('/assets/stats');
  const card = page.locator('div.rounded-2xl').filter({ has: page.getByRole('heading', { name: '배당금 현황', exact: true }) }).last();
  if (tomorrow.slice(0, 4) !== today.slice(0, 4)) await card.locator('button').nth(1).click();
  await expect(card.getByText('240원', { exact: true })).toBeVisible();
});

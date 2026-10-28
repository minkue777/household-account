import { expect, test } from '@playwright/test';
import { createHouseholdThroughUi, executeHouseholdCommand, resetTestAccount } from './emulator';
import { fixture, modal } from './portfolio-helpers';

test('[T-PERF-HOLD-001][HOLD-005] 계좌는 배당 응답 전에 열리고 클릭 없이 최근 배당을 표시한다', async ({ page, request }) => {
  await resetTestAccount();
  const scope = await createHouseholdThroughUi(page);
  const { assetId } = await executeHouseholdCommand<{ assetId: string }>(request, {
    ...scope, command: 'portfolio.create-asset.v1',
    payload: { asset: { name: '배당 조회 계좌', type: 'stock', owner: '가구', ownerRef: { kind: 'household' }, currentBalance: 0, currency: 'KRW', order: 1, isActive: true } },
  });
  await executeHouseholdCommand(request, {
    ...scope, command: 'portfolio.add-position.v1',
    payload: { assetId, positionKind: 'stock', expectedAssetVersion: 1, position: { assetId, stockCode: '069500', stockName: '배당 ETF', market: 'KRX', instrumentType: 'etf', holdingType: 'stock', quantity: 5, avgPrice: 1_000, currentPrice: 1_000 } },
  });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const year = Number(today.slice(0, 4));
  const writeProjection = (amount: number) => fixture(request, `dividend_snapshots/${scope.householdId}_${year}`, {
    householdId: scope.householdId, year,
    events: { 'paid-e2e': { eventId: 'paid-e2e', instrumentCode: '069500', instrumentName: '배당 ETF', paymentDate: today, perShareAmount: amount } },
  });
  await writeProjection(120);

  // 응답을 조작하지 않고 실제 Auth/Functions/Firestore 조회의 전달만 보류합니다.
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let queries = 0;
  await page.route('**/executeHouseholdQuery', async route => {
    if (route.request().postDataJSON()?.data?.query !== 'portfolio.get-dividend-projection.v1') {
      await route.continue();
      return;
    }
    queries += 1;
    const response = await route.fetch();
    if (queries === 1) await gate;
    await route.fulfill({ response });
  });
  try {
    await page.goto('/assets');
    await page.locator(`[data-asset-id="${assetId}"]`).click();
    const detail = modal(page, '배당 조회 계좌');
    await expect(detail.getByRole('button', { name: /배당 ETF/ })).toBeVisible();
    await expect(detail.getByText('배당 정보를 불러오는 중입니다.')).toBeVisible();
    await expect.poll(() => queries).toBe(1);
    release();
    await expect(detail.getByText('최근 지급 120원 · 연 1회')).toBeVisible();
    await expect(detail.getByText(`최근 지급일: ${today}`)).toBeVisible();
    await expect(detail.getByLabel('수량', { exact: true })).toHaveCount(0);
    await detail.getByRole('button', { name: /배당 ETF/ }).click();
    await expect(detail.getByLabel('수량', { exact: true })).toHaveValue('5');
    expect(queries).toBe(1);
    await detail.getByRole('button', { name: '닫기', exact: true }).click();
    await writeProjection(150);
    await page.locator(`[data-asset-id="${assetId}"]`).click();
    await expect(detail.getByText('최근 지급 150원 · 연 1회')).toBeVisible();
    expect(queries).toBe(2);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

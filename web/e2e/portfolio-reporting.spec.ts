import { expect, test } from '@playwright/test';
import { createHouseholdThroughUi, E2E_PROJECT_ID, executeHouseholdCommand, firestoreFields, resetTestAccount } from './emulator';
import { documents, fixture, runScheduled } from './portfolio-helpers';

test.beforeEach(async () => { await resetTestAccount(); });

function monthsAgo(months: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

test('[T-STAT-AST-001][AST-004][AST-005][STAT-AST-001][STAT-AST-002][STAT-AST-003][STAT-006] 서로 다른 기간 baseline·금융자산 전환은 실제 이력 금액을 사용한다', async ({ page, request }) => {
  const scope = await createHouseholdThroughUi(page);
  for (const [name, type, balance] of [['예금', 'savings', 500_000], ['집', 'property', 500_000]] as const) {
    await executeHouseholdCommand(request, { ...scope, command: 'portfolio.create-asset.v1', payload: { asset: { name, type, owner: '공동', ownerRef: { kind: 'household' }, currency: 'KRW', currentBalance: balance, isActive: true, order: 1 } } });
  }
  const snapshots = [
    ['2019-01-01', 100_000], [monthsAgo(14), 200_000],
    [monthsAgo(7), 400_000], [monthsAgo(4), 600_000], [monthsAgo(1), 0],
  ] as const;
  for (const [date, balance] of snapshots) {
    await fixture(request, `households/${scope.householdId}/assetSnapshots/${date}`, {
      householdId: scope.householdId, localDate: date, total: balance, financial: balance / 2,
      byType: { savings: balance / 2, property: balance / 2, stock: 0 }, byOwnerRefKey: { household: balance }, ownerDisplayNames: { household: '공동' },
    });
  }
  await page.goto('/assets/stats');
  await expect(page.getByRole('button', { name: '3개월', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('+400,000원 (+66.67%)', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '주식', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '공동', exact: true })).toHaveCount(0);
  // 응답을 만들어 주지 않고 실제 SDK 요청 수와 화면 전환을 관찰합니다.
  const historyReads: string[] = [];
  page.on('request', request => {
    if (!request.url().includes('google.firestore.v1.Firestore')) return;
    const body = request.postData() ?? '';
    // Web SDK getDocs는 Listen WebChannel의 addTarget으로도 전송됩니다.
    // keepalive가 아닌 실제 assetSnapshots 조회 대상 재전송을 관찰합니다.
    const decoded = Array.from(new URLSearchParams(body).values()).join('\n');
    if (`${body}\n${decoded}`.includes('assetSnapshots')) historyReads.push(body);
  });
  await page.evaluate(() => {
    const runtime = window as typeof window & { e2eStatisticsLoading: boolean; e2eStatisticsObserver: MutationObserver };
    runtime.e2eStatisticsLoading = false;
    runtime.e2eStatisticsObserver = new MutationObserver(() => {
      if (document.querySelector('[role="status"]')?.textContent?.includes('불러오는 중')) runtime.e2eStatisticsLoading = true;
    });
    runtime.e2eStatisticsObserver.observe(document.body, { childList: true, subtree: true });
  });
  for (const [label, change] of [['6개월', '+600,000원 (+150.00%)'], ['1년', '+800,000원 (+400.00%)'], ['전체 기간', '+900,000원 (+900.00%)'], ['3개월', '+400,000원 (+66.67%)']]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByText(change, { exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: '전체자산', exact: true }).click();
  await expect(page.getByText('+200,000원 (+66.67%)', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '부동산', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => {
    const runtime = window as typeof window & { e2eStatisticsLoading: boolean; e2eStatisticsObserver: MutationObserver };
    runtime.e2eStatisticsObserver.disconnect(); return runtime.e2eStatisticsLoading;
  })).toBe(false);
  expect(historyReads).toEqual([]);
  expect(await page.locator('canvas').count()).toBeGreaterThan(0);
});

test('[STAT-005] 잘못된 실제 저장 이력은 빈 성공으로 숨기지 않고 통계 실패를 표시한다', async ({ page, request }) => {
  const scope = await createHouseholdThroughUi(page);
  await fixture(request, `households/${scope.householdId}/assetSnapshots/invalid`, {
    householdId: scope.householdId, localDate: monthsAgo(1), total: 'not-a-number', financial: 0, byType: {}, byOwnerRefKey: {},
  });
  await page.goto('/assets/stats');
  await expect(page.getByRole('alert').filter({ hasText: '자산 통계를 불러오지 못했습니다.' })).toBeVisible();
  await expect(page.getByText('표시할 자산 데이터가 없습니다.', { exact: true })).toHaveCount(0);
});

test('[DIV-006][STAT-005] 배당 이벤트의 실제 SDK 조회 이후 변환 오류는 데이터 없음으로 숨기지 않는다', async ({ page, request }) => {
  const scope = await createHouseholdThroughUi(page);
  const year = Number(monthsAgo(0).slice(0, 4));
  // 저장 계약이 깨진 데이터를 주입합니다. SDK와 조회·정렬·화면 오류 경로는 실제 코드를 실행합니다.
  for (const suffix of ['a', 'b']) {
    await fixture(request, `dividend_events/invalid-name-${suffix}`, {
      householdId: scope.householdId, eventId: `kind:invalid-${suffix}:069500`, stockCode: '069500',
      stockName: { invalid: true }, recordDate: `${year}-01-01`, paymentDate: `${year}-01-15`,
      perShareAmount: 10, eligibleQuantity: 1, totalAmount: 10, status: 'paid',
    });
  }
  await page.goto('/assets/stats');
  const card = page.locator('div.rounded-2xl').filter({ has: page.getByRole('heading', { name: '배당금 현황', exact: true }) }).last();
  await expect(card.getByRole('alert')).toHaveText('배당금 정보를 불러오지 못했습니다.');
  await expect(card.getByText('데이터 없음', { exact: true })).toHaveCount(0);
});

test('[T-DIV-001][T-DIV-004][T-DIV-007][T-JOB-DIV-001][DIV-001][DIV-003][DIV-004][DIV-006][JOB-DIV-001] 원천 자산이 없어도 fixed 배당은 실제 예약 실행에서 paid로 진행하고 연간 UI에 보존된다', async ({ page, request }) => {
  const scope = await createHouseholdThroughUi(page);
  const year = Number(monthsAgo(0).slice(0, 4));
  // 이미 수집·확정한 과거 공시만 시작 fixture로 준비합니다. 신규 외부 공시 수집을 대역하지 않습니다.
  await fixture(request, 'dividend_events/confirmed-disclosure', {
    schemaVersion: 1, eventId: 'kind:disclosure-001:069500', householdId: scope.householdId,
    instrumentCode: '069500', stockCode: '069500', stockName: 'E2E 확정 ETF', instrumentName: 'E2E 확정 ETF', sourceDisclosureId: 'disclosure-001',
    recordDate: `${year}-01-01`, paymentDate: `${year}-01-15`, perShareAmount: 120,
    eligibleQuantity: 10, totalAmount: 1_200, status: 'fixed', aggregateVersion: 1, sourceAssetIds: ['already-deleted-asset'],
  });
  await runScheduled('dividendHourly', `${year}-01-15T09:00:00+09:00`);
  expect((await documents(request, 'dividend_events'))[0]).toMatchObject({ status: 'paid', totalAmount: 1_200 });
  const projection = (await documents(request, 'dividend_snapshots'))[0];
  expect(projection.monthlyData).toEqual([1_200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  expect(Object.keys(projection.events as object)).toEqual(['kind:disclosure-001:069500']);
  const overwrite = await request.patch(`http://127.0.0.1:8080/v1/projects/${E2E_PROJECT_ID}/databases/(default)/documents/dividend_snapshots/${scope.householdId}_${year}`, {
    headers: { authorization: `Bearer ${scope.idToken}` },
    data: { fields: firestoreFields({ householdId: scope.householdId, year, monthlyData: Array(12).fill(999) }) },
  });
  expect(overwrite.status()).toBe(403);
  expect((await documents(request, 'dividend_snapshots'))[0].monthlyData).toEqual(projection.monthlyData);
  await runScheduled('dividendHourly', `${year}-01-15T10:00:00+09:00`);
  expect((await documents(request, 'dividend_snapshots'))[0].monthlyData).toEqual(projection.monthlyData);
  await page.goto('/assets/stats');
  const card = page.locator('div.rounded-2xl').filter({ has: page.getByRole('heading', { name: '배당금 현황', exact: true }) }).last();
  await expect(card.getByText('1,200원', { exact: true })).toBeVisible();
  await card.locator('button').first().click();
  await expect(card.getByText(`${year - 1}년`, { exact: true })).toBeVisible();
  await expect(card.getByText('데이터 없음', { exact: true })).toBeVisible();
  // 기존 연간 데이터의 짧은 월 배열도 실제 SDK를 거쳐 12개월 조회로 복원합니다.
  await fixture(request, `dividend_snapshots/${scope.householdId}_${year - 1}`, { householdId: scope.householdId, year: year - 1, monthlyData: [50, ...Array(9).fill(0)] });
  await card.locator('button').nth(1).click();
  await expect(card.getByText('1,200원', { exact: true })).toBeVisible();
  await card.locator('button').first().click();
  await expect(card.getByText('50원', { exact: true })).toBeVisible();
});

test('[AST-008][JOB-AST-001][JOB-AST-002][JOB-AST-003] 빈 가구의 실제 평가 Scheduler는 사라진 자산 scope를 명시적 0으로 기록한다', async ({ page, request }) => {
  const scope = await createHouseholdThroughUi(page);
  await fixture(request, `households/${scope.householdId}/assetSnapshots/2025-01-01`, {
    schemaVersion: 1, householdId: scope.householdId, localDate: '2025-01-01', total: 100_000, financial: 100_000,
    byType: { stock: 100_000 }, byOwnerRefKey: { 'profile:archived-owner': 100_000 }, ownerDisplayNames: { 'profile:archived-owner': '과거 명의자' },
  });
  await runScheduled('assetValuationDaily', '2025-01-02T23:55:00+09:00');
  const snapshot = (await documents(request, `households/${scope.householdId}/assetSnapshots`)).find(x => x.localDate === '2025-01-02');
  expect(snapshot).toMatchObject({ total: 0, financial: 0, byType: { stock: 0 }, byOwnerRefKey: { 'profile:archived-owner': 0 } });
});

test('[T-DIV-005][DIV-002][DIV-005][DIV-006] 발표 배당 예상액을 표시하고 자산 삭제 후에도 최근 보유 이력으로 확정 수량을 복구한다', async ({ page, request }) => {
  const scope = await createHouseholdThroughUi(page);
  const asset = await executeHouseholdCommand<{ assetId: string }>(request, { ...scope, command: 'portfolio.create-asset.v1', payload: { asset: { name: '배당 ETF 계좌', type: 'stock', owner: '가구', ownerRef: { kind: 'household' }, currentBalance: 0, currency: 'KRW', order: 1, isActive: true } } });
  const holding = await executeHouseholdCommand<{ positionId: string }>(request, { ...scope, command: 'portfolio.add-position.v1', payload: { assetId: asset.assetId, positionKind: 'stock', expectedAssetVersion: 1, position: { assetId: asset.assetId, stockCode: '069500', stockName: 'E2E 배당 ETF', market: 'KRX', instrumentType: 'etf', holdingType: 'stock', quantity: 5, avgPrice: 1_000, currentPrice: 1_000 } } });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const shift = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  await fixture(request, 'dividend_events/announced-e2e', { schemaVersion: 1, eventId: 'kind:e2e-announced:069500', householdId: scope.householdId, instrumentCode: '069500', instrumentName: 'E2E 배당 ETF', stockCode: '069500', stockName: 'E2E 배당 ETF', sourceDisclosureId: 'e2e-announced', recordDate: shift(2), paymentDate: shift(7), perShareAmount: 30, status: 'announced', aggregateVersion: 1, sourceAssetIds: [asset.assetId] });
  await page.goto('/assets/stats');
  const card = page.locator('div.rounded-2xl').filter({ has: page.getByRole('heading', { name: '배당금 현황', exact: true }) }).last();
  await expect(card.getByText('150원', { exact: true })).toBeVisible();
  for (const [days, quantity] of [[1, 7], [3, 11]]) {
    await fixture(request, `households/${scope.householdId}/positionHistory/e2e-${days}`, { householdId: scope.householdId, assetId: asset.assetId, positionId: holding.positionId, instrument: { code: '069500', market: 'KRX' }, snapshotDate: shift(days), observedAt: `${shift(days)}T00:00:00Z`, sourceVersion: '1', quantity });
  }
  await executeHouseholdCommand(request, { ...scope, command: 'portfolio.delete-asset.v1', payload: { assetId: asset.assetId, expectedVersion: 2 } });
  await runScheduled('dividendHourly', `${shift(2)}T09:00:00+09:00`);
  expect((await documents(request, 'dividend_events')).find(x => x.id === 'announced-e2e')).toMatchObject({ status: 'fixed', eligibleQuantity: 7, totalAmount: 210 });
  await page.reload();
  await expect(card.getByText('210원', { exact: true })).toBeVisible();
});

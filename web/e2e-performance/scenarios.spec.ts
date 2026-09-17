import { expect, test, type BrowserContextOptions, type Page, type TestInfo } from '@playwright/test';
import { installMeasurement, markNextAction, measure, type MeasurementOptions } from './measurement';
import {
  ASSET_COUNT, STOCK_COUNT, EXPENSES_PER_MONTH, FIXTURE_MONTHS, LOCAL_CURRENCY_BALANCE,
  assetPeriodChange, installCatalogFixture, preparePerformanceFixture, readFixtureDocument, type PerformanceFixture,
} from './fixtures';

const SAMPLES = Number(process.env.PERFORMANCE_SAMPLES ?? 7);
const COMPLETE_PAINT = 'household-account:startup:home:first-complete-paint';
const won = (amount: number) => amount.toLocaleString('ko-KR');

interface DomExpectation {
  selector: string;
  text?: string;
  additionalText?: string;
  count?: number;
  value?: string;
  attribute?: [string, string];
}
interface ReadyData { elements: DomExpectation[]; mark?: string }
/** Browser-side predicate is serialized: no imported code, closures or polling clocks. */
function domReady(data: ReadyData): boolean {
  if (data.mark && performance.getEntriesByName(data.mark).length === 0) return false;
  return data.elements.every(expected => {
    const nodes = Array.from(document.querySelectorAll(expected.selector));
    if (expected.count !== undefined && nodes.length !== expected.count) return false;
    if (expected.count === 0) return true;
    return nodes.some(node => {
      if (expected.text !== undefined && !node.textContent?.includes(expected.text)) return false;
      if (expected.additionalText !== undefined && !node.textContent?.includes(expected.additionalText)) return false;
      if (expected.value !== undefined && (node as HTMLInputElement).value !== expected.value) return false;
      if (expected.attribute && node.getAttribute(expected.attribute[0]) !== expected.attribute[1]) return false;
      return true;
    });
  });
}

function homeData(fixture: PerformanceFixture, monthIndex = 0): ReadyData {
  return { elements: [
    { selector: '.calendar-glass', attribute: ['aria-busy', 'false'] },
    { selector: '.balance-card-glass', text: won(fixture.monthTotals[monthIndex]) },
    { selector: '.balance-card-glass', text: won(LOCAL_CURRENCY_BALANCE) },
  ] };
}
async function expectHome(page: Page, fixture: PerformanceFixture, monthIndex = 0) {
  await expect(page.locator('.calendar-glass')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.balance-card-glass').filter({ hasText: /월 지출/ })).toContainText(won(fixture.monthTotals[monthIndex]));
  await expect(page.locator('.balance-card-glass').filter({ hasText: '지역화폐 잔액' })).toContainText(won(LOCAL_CURRENCY_BALANCE));
}
const assetData = (fixture: PerformanceFixture): ReadyData => ({ elements: [
  { selector: '[data-asset-id]', count: ASSET_COUNT },
  { selector: 'p.text-2xl', text: won(fixture.assetTotal) },
  // The asset list can precede the daily snapshot: non-zero change is part of readiness.
  { selector: 'main p', text: '+0.01% (1,000원)' },
] });
async function expectAssets(page: Page, fixture: PerformanceFixture) {
  await expect(page.locator('[data-asset-id]')).toHaveCount(ASSET_COUNT);
  await expect(page.locator('p.text-2xl')).toContainText(won(fixture.assetTotal));
  await expect(page.getByText('+0.01% (1,000원)', { exact: true })).toBeVisible();
}
function statsData(total: number): ReadyData {
  return { elements: [{ selector: 'span.text-xl.font-bold', text: `${won(total)}원` }, { selector: 'canvas', count: 2 }] };
}
async function expectExpenseStats(page: Page, total: number) {
  await expect(page.locator('span.text-xl.font-bold')).toHaveText(`${won(total)}원`);
  await expect(page.locator('canvas')).toHaveCount(2);
  await expectNoStatisticsError(page);
}
async function expectNoStatisticsError(page: Page) {
  // Next의 shadow DOM route announcer도 role=alert이므로 제품 오류 영역을 검사합니다.
  const main = page.locator('main');
  await expect(main.getByRole('alert')).toHaveCount(0);
  await expect(main.getByText(/통계를 불러오지 못했습니다|조회 실패|배당금 정보를 불러오지 못했습니다/)).toHaveCount(0);
}

async function settleInitialServiceWorker(page: Page, testInfo: TestInfo, iteration: number) {
  // 홈 paint 뒤 앱이 예약한 실제 첫 worker 설치를 완료한 다음 창을 닫습니다.
  // 설치/배너 대기 시간은 홈 측정값에 포함하지 않으며 register/skipWaiting을 대행하지 않습니다.
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    return registration?.active?.state === 'activated'
      && registration.waiting === null && registration.installing === null
      && navigator.serviceWorker.controller === registration.active;
  }), { timeout: 45_000, intervals: [100, 250, 500] }).toBe(true);
  const worker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    return { active: registration?.active?.scriptURL, waiting: registration?.waiting?.scriptURL,
      controller: navigator.serviceWorker.controller?.scriptURL };
  });
  await testInfo.attach('performance-pwa-preparation', { contentType: 'application/json', body: JSON.stringify({
    iteration, worker, updateBannerVisibleAfterInitialActivation: await page.getByRole('status').filter({ hasText: '새 버전이 준비되었습니다.' }).isVisible(),
    preparation: 'wait-for-product-registration-activation-before-closing-first-document',
  }) });
}
function assetStatsData(fixture: PerformanceFixture, months: 3 | 6 | 12 | 'all'): ReadyData {
  return { elements: [
    { selector: 'main p', text: assetPeriodChange(fixture, months) },
    { selector: 'p.text-2xl', text: won(fixture.assetTotal) },
    { selector: 'canvas', count: 3 },
    { selector: 'span.text-lg.font-bold.text-red-500', text: '데이터 없음' },
  ] };
}
async function expectAssetStats(page: Page, fixture: PerformanceFixture, months: 3 | 6 | 12 | 'all') {
  await expect(page.getByText(assetPeriodChange(fixture, months), { exact: true })).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(3);
  const dividend = page.locator('div.rounded-2xl').filter({ has: page.getByRole('heading', { name: '배당금 현황', exact: true }) }).last();
  await expect(dividend.getByText('데이터 없음', { exact: true })).toBeVisible();
  await expectNoStatisticsError(page);
}

async function measureJourney(page: Page, testInfo: TestInfo, fixture: PerformanceFixture, iteration: number) {
  const base = { iteration, warmup: iteration === 0 };
  const run = (options: Omit<MeasurementOptions, 'iteration' | 'warmup' | 'browserReady'>) => measure(page, testInfo, {
    ...base, ...options, browserReady: domReady,
  });
  const targetItem = () => page.getByTestId('expense-item').filter({ hasText: fixture.targetMerchant });
  const editDialog = () => page.getByRole('dialog', { name: '지출 수정', exact: true });
  const goHome = () => page.locator('header a[href="/"]').first().click();

  await run({ id: 'ledger.select-day', label: '날짜 선택 → 해당 지출 표시', cacheState: 'same-month-memory',
    action: () => page.getByTestId(`calendar-day-${fixture.targetDate}`).click(),
    data: { elements: [{ selector: '[data-testid="expense-item"]', text: fixture.targetMerchant }] },
    ready: async () => { await expect(targetItem()).toContainText(`${won(fixture.targetAmount)}원`); },
  });
  await run({ id: 'ledger.open-detail', label: '지출 선택 → 수정 화면 준비', cacheState: 'same-month-memory',
    action: () => targetItem().click(),
    data: { elements: [{ selector: '[role="dialog"] input[type="text"]', value: fixture.targetMerchant },
      { selector: '[role="dialog"] input[type="number"]', value: String(fixture.targetAmount) }] },
    ready: async () => { await expect(editDialog().getByRole('button', { name: '저장', exact: true })).toBeEnabled(); },
  });
  const memo = `성능 측정 메모 ${testInfo.project.name} ${iteration}`;
  await editDialog().getByPlaceholder('메모를 입력하세요').fill(memo);
  await run({ id: 'ledger.save-memo', label: '메모 저장 → 지출 목록 반영', cacheState: 'same-month-memory',
    command: true, commandName: 'ledger.update-transaction.v1', action: () => editDialog().getByRole('button', { name: '저장', exact: true }).click(),
    data: { elements: [{ selector: '[role="dialog"]', count: 0 }, { selector: '[data-testid="expense-item"]', text: memo }] },
    ready: async () => { await expect(targetItem()).toContainText(memo); },
  });
  expect(await readFixtureDocument(page.request, `households/${fixture.householdId}/ledgerTransactions/${fixture.targetId}`)).toMatchObject({ memo });
  await targetItem().click();
  const categoryLabel = iteration % 2 === 0 ? '식비' : '기타';
  const categoryId = iteration % 2 === 0 ? fixture.categories.food : fixture.categories.other;
  await editDialog().getByRole('button', { name: categoryLabel, exact: true }).click();
  await run({ id: 'ledger.save-category', label: '카테고리 저장 → 지출 목록 반영', cacheState: 'same-month-memory',
    command: true, commandName: 'ledger.update-transaction.v1', action: () => editDialog().getByRole('button', { name: '저장', exact: true }).click(),
    data: { elements: [{ selector: '[role="dialog"]', count: 0 }, { selector: '[data-testid="expense-item"]', text: fixture.targetMerchant, additionalText: categoryLabel }] },
    ready: async () => { await expect(targetItem().getByText(categoryLabel, { exact: true })).toBeVisible(); },
  });
  expect(await readFixtureDocument(page.request, `households/${fixture.householdId}/ledgerTransactions/${fixture.targetId}`)).toMatchObject({ categoryId });

  await run({ id: 'ledger.previous-month', label: '이전 달 → 달력·월 합계', cacheState: 'first-previous-month-in-context',
    action: () => page.getByRole('button', { name: '이전 달', exact: true }).click(), data: homeData(fixture, 1),
    ready: () => expectHome(page, fixture, 1),
  });
  await run({ id: 'ledger.return-month', label: '원래 달 복귀 → 달력·월 합계', cacheState: 'month-memory',
    action: () => page.getByRole('button', { name: '다음 달', exact: true }).click(), data: homeData(fixture),
    ready: () => expectHome(page, fixture),
  });

  // Keep both boundaries: prefetch on opening must not hide waiting before input.
  await markNextAction(page, 'search-open');
  await page.locator('header button').first().click();
  const searchInput = page.getByPlaceholder('지출처명, 메모, 카드명을 검색해보세요');
  const search = page.locator('div.fixed').filter({ has: searchInput });
  const summary = `${FIXTURE_MONTHS * EXPENSES_PER_MONTH}건 · ${won(fixture.totalExpenseAmount)}원`;
  await run({ id: 'search.first', label: '전체 기간 검색 → 첫 결과·전체 합계', cacheState: 'first-search-window', startEvent: 'input',
    fromAction: { mark: 'search-open', id: 'search.first-open', label: '검색 열기·즉시 입력 → 첫 결과·전체 합계' },
    action: () => searchInput.fill('성능 원장'), data: { elements: [{ selector: 'div.fixed', text: summary }, { selector: 'div.fixed', text: '성능 원장 00-27' }] },
    ready: async () => { await expect(search.getByText(summary, { exact: true })).toBeVisible(); await expect(search.getByText(/^성능 원장 (?:00-\d{2}|수정 대상)$/)).toHaveCount(EXPENSES_PER_MONTH); },
  });
  await run({ id: 'search.expand-month', label: '과거 검색 월 선택 → 해당 월 전체 내역', cacheState: 'search-window-memory',
    action: () => search.getByRole('button').filter({ hasText: /^\d{4}년 \d+월.*건/ }).nth(1).click(),
    data: { elements: [{ selector: 'div.fixed', text: summary }, { selector: 'div.fixed', text: '성능 원장 01-00' }] },
    ready: async () => { await expect(search.getByText(/^성능 원장 01-\d{2}$/)).toHaveCount(EXPENSES_PER_MONTH); await expect(search.getByText(/^성능 원장 00-/)).toHaveCount(0); },
  });
  await run({ id: 'search.change-keyword', label: '검색어 변경 → 새 결과·합계', cacheState: 'search-window-memory', startEvent: 'input',
    action: () => searchInput.fill('수정 대상'),
    data: { elements: [{ selector: 'div.fixed', text: `1건 · ${won(fixture.targetAmount)}원` }] },
    ready: async () => { await expect(search.getByText(`1건 · ${won(fixture.targetAmount)}원`, { exact: true })).toBeVisible(); await expect(search.getByText(fixture.targetMerchant, { exact: true })).toBeVisible(); },
  });
  await search.getByRole('button', { name: '닫기', exact: true }).click();

  const expenseTotal = (months: number) => fixture.monthTotals.slice(0, months).reduce((sum, amount) => sum + amount, 0);
  await run({ id: 'expense-stats.first', label: '지출 통계 첫 진입 → 합계·차트', cacheState: 'first-statistics-in-context', charts: true,
    action: () => page.locator('a[href="/stats"]').click(), data: statsData(expenseTotal(12)), ready: () => expectExpenseStats(page, expenseTotal(12)),
  });
  for (const [label, months] of [['3개월', 3], ['6개월', 6], ['1년', 12]] as const) {
    await run({ id: `expense-stats.period-${months}`, label: `지출 통계 ${label} → 합계·차트`, cacheState: 'statistics-memory', charts: true,
      action: () => page.getByRole('button', { name: label, exact: true }).click(), data: statsData(expenseTotal(months)), ready: () => expectExpenseStats(page, expenseTotal(months)),
    });
  }
  await goHome(); await expectHome(page, fixture);
  await run({ id: 'expense-stats.revisit', label: '지출 통계 재진입 → 합계·차트', cacheState: 'statistics-memory', charts: true,
    action: () => page.locator('a[href="/stats"]').click(), data: statsData(expenseTotal(12)), ready: () => expectExpenseStats(page, expenseTotal(12)),
  });
  await goHome(); await expectHome(page, fixture);

  await run({ id: 'assets.first', label: '자산 첫 화면 → 총액·목록·전일 증감', cacheState: 'first-assets-in-context',
    action: () => page.locator('a[href="/assets"]').click(), data: assetData(fixture), ready: () => expectAssets(page, fixture),
  });
  const detail = page.locator('div.fixed.inset-0').filter({ has: page.getByRole('heading', { name: '성능 증권계좌', exact: true }) }).last();
  await run({ id: 'assets.account-detail', label: '계좌 선택 → 보유 20항목·평가금액', cacheState: 'asset-page-holdings-prefetch',
    action: () => page.locator(`[data-asset-id="${fixture.stockAssetId}"]`).click(),
    data: { elements: [{ selector: 'div.fixed', text: '평가금액 2,100,000원' }, { selector: 'div.fixed', text: '성능 보유항목 20' }] },
    ready: async () => { await expect(detail.getByRole('button', { name: /성능 보유항목 \d{2}/ })).toHaveCount(STOCK_COUNT); await expect(detail).toContainText('평가금액 2,100,000원'); },
  });
  await detail.getByRole('button', { name: '닫기', exact: true }).click();
  await run({ id: 'ledger.return-from-assets', label: '자산에서 홈 복귀 → 달력·월 합계', cacheState: 'home-memory',
    action: goHome, data: homeData(fixture), ready: () => expectHome(page, fixture),
  });
  await run({ id: 'assets.revisit', label: '자산 화면 재진입 → 총액·목록·증감', cacheState: 'asset-memory',
    action: () => page.locator('a[href="/assets"]').click(), data: assetData(fixture), ready: () => expectAssets(page, fixture),
  });
  await run({ id: 'asset-stats.first', label: '자산 통계 첫 진입 → 합계·차트', cacheState: 'first-asset-statistics-in-context', charts: true,
    action: () => page.locator('a[href="/assets/stats"]').click(), data: assetStatsData(fixture, 3), ready: () => expectAssetStats(page, fixture, 3),
  });
  for (const [label, months] of [['6개월', 6], ['1년', 12], ['전체 기간', 'all'], ['3개월', 3]] as const) {
    await run({ id: `asset-stats.period-${months}`, label: `자산 통계 ${label} → 합계·차트`, cacheState: 'complete-snapshot-memory', charts: true, chartIndexes: [0],
      action: () => page.getByRole('button', { name: label, exact: true }).click(), data: assetStatsData(fixture, months), ready: () => expectAssetStats(page, fixture, months),
    });
  }
  await page.locator('header a[href="/assets"]').click(); await expectAssets(page, fixture);
  await run({ id: 'asset-stats.revisit', label: '자산 통계 재진입 → 합계·차트', cacheState: 'asset-statistics-memory', charts: true,
    action: () => page.locator('a[href="/assets/stats"]').click(), data: assetStatsData(fixture, 3), ready: () => expectAssetStats(page, fixture, 3),
  });
  await page.locator('header a[href="/assets"]').click(); await expectAssets(page, fixture);
  await goHome(); await expectHome(page, fixture);
  await page.getByTestId(`calendar-day-${fixture.targetDate}`).click();

  const merchant = `성능 추가 ${testInfo.project.name} ${iteration}`;
  await page.getByRole('button', { name: '지출 추가', exact: true }).click();
  const add = page.getByRole('dialog', { name: '지출 추가', exact: true });
  await add.getByPlaceholder('가맹점명을 입력하세요').fill(merchant);
  await add.locator('input[type="number"]').fill('9900');
  await add.locator('input[type="date"]').fill(fixture.targetDate);
  await add.getByRole('button', { name: '기타', exact: true }).click();
  const created = page.waitForResponse(response => response.url().endsWith('/executeHouseholdCommand')
    && response.request().postDataJSON()?.data?.command === 'ledger.record-manual-transaction.v1');
  await run({ id: 'ledger.add', label: '지출 추가 → 목록·월 합계 반영', cacheState: 'same-month-memory', command: true, commandName: 'ledger.record-manual-transaction.v1',
    action: () => add.getByRole('button', { name: '추가', exact: true }).click(),
    data: { elements: [{ selector: '[role="dialog"]', count: 0 }, { selector: '[data-testid="expense-item"]', text: merchant }, { selector: '.balance-card-glass', text: won(fixture.monthTotals[0] + 9900) }] },
    ready: async () => { await expect(page.getByTestId('expense-item').filter({ hasText: merchant })).toContainText('9,900원'); },
  });
  const createdId = (await (await created).json()).result.result.value.transactionId as string;
  expect(await readFixtureDocument(page.request, `households/${fixture.householdId}/ledgerTransactions/${createdId}`)).toMatchObject({ merchant, amountInWon: 9900, lifecycleState: 'active' });
  await page.getByTestId('expense-item').filter({ hasText: merchant }).click();
  await editDialog().getByRole('button', { name: '삭제', exact: true }).click();
  await run({ id: 'ledger.delete', label: '삭제 확인 → 목록·월 합계 반영', cacheState: 'same-month-memory', command: true, commandName: 'ledger.delete-transaction.v1',
    action: () => page.getByRole('dialog', { name: '지출 삭제', exact: true }).getByRole('button', { name: '삭제', exact: true }).click(),
    data: { elements: [{ selector: '[role="dialog"]', count: 0 }, ...homeData(fixture).elements] },
    ready: async () => { await expect(page.getByTestId('expense-item').filter({ hasText: merchant })).toHaveCount(0); await expectHome(page, fixture); },
  });
  expect(await readFixtureDocument(page.request, `households/${fixture.householdId}/ledgerTransactions/${createdId}`)).toMatchObject({ lifecycleState: 'deleted' });
}

test('핵심 사용 경로의 실제 Emulator 성능 기준선', async ({ page: setupPage, browser, request }, testInfo) => {
  test.setTimeout(30 * 60_000);
  expect(Number.isInteger(SAMPLES) && SAMPLES >= 1 && SAMPLES <= 30).toBe(true);
  // Fixture setup uses the same PWA persistence/transport as the measured iPhone.
  // Otherwise WebKit setup exercises desktop IndexedDB before measurement starts.
  if (testInfo.project.name.includes('webkit')) await setupPage.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  const fixture = await preparePerformanceFixture(setupPage, request);
  const storage = await setupPage.context().storageState({ indexedDB: true });
  // 로그인·저장된 bootstrap metadata를 유지하며 Firestore 영속 캐시는 제거합니다.
  for (const origin of storage.origins) {
    const withIndexedDb = origin as typeof origin & { indexedDB?: Array<{ name: string }> };
    withIndexedDb.indexedDB = withIndexedDb.indexedDB?.filter(db => db.name === 'firebaseLocalStorageDb');
  }
  await setupPage.close();
  const project = testInfo.project.use;
  const options: BrowserContextOptions = {
    baseURL: String(project.baseURL ?? 'http://127.0.0.1:3100'), viewport: project.viewport,
    userAgent: project.userAgent, deviceScaleFactor: project.deviceScaleFactor, isMobile: project.isMobile,
    hasTouch: project.hasTouch, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: storage,
  };
  await testInfo.attach('performance-fixture', { contentType: 'application/json', body: JSON.stringify({
    version: 1, months: FIXTURE_MONTHS, expenseCount: FIXTURE_MONTHS * EXPENSES_PER_MONTH,
    memberCount: 3, assetCount: ASSET_COUNT, stockCount: STOCK_COUNT, snapshotCount: fixture.snapshotCount,
    anchorDate: fixture.today, warmupCount: 1, sampleCount: SAMPLES,
    project: testInfo.project.name, browserVersion: browser.version(),
    holdingMode: 'manual-fixed-value; external market-provider latency excluded',
    catalogSource: 'same-origin-real-http-fixture/catalog-only-xhr-url-redirect-after-home', journeyHttpCache: 'normal-browser-and-service-worker-cache',
    pwaPreparation: 'complete-actual-initial-install-after-first-home-before-relaunch',
  }) });
  for (let iteration = 0; iteration <= SAMPLES; iteration += 1) {
    const context = await browser.newContext(options);
    if (testInfo.project.name.includes('webkit')) await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
    const errors: string[] = [];
    let page: Page | undefined;
    try {
      page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await installMeasurement(page);
      await measure(page, testInfo, { id: 'home.fresh-context', label: '첫 홈 → 달력·월 합계·지역화폐 표시', iteration, warmup: iteration === 0,
        cacheState: 'new-context/persisted-auth-and-bootstrap/empty-http-and-firestore-cache', navigation: true,
        action: async () => { await page!.goto('/'); }, browserReady: domReady, data: { ...homeData(fixture), mark: COMPLETE_PAINT },
        ready: () => expectHome(page!, fixture),
      });
      await settleInitialServiceWorker(page, testInfo, iteration);
      await page.close();
      page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await installMeasurement(page);
      await measure(page, testInfo, { id: 'home.relaunch', label: '앱 문서 재실행 → 홈 데이터 표시', iteration, warmup: iteration === 0,
        cacheState: 'same-context/new-document/persisted-auth-http-and-active-service-worker-static-cache', navigation: true,
        action: async () => { await page!.goto('/'); }, browserReady: domReady, data: { ...homeData(fixture), mark: COMPLETE_PAINT },
        ready: () => expectHome(page!, fixture),
      });
      await expect(page.getByRole('status').filter({ hasText: '새 버전이 준비되었습니다.' })).toHaveCount(0);
      await installCatalogFixture(context);
      await measureJourney(page, testInfo, fixture, iteration);
      expect(errors).toEqual([]);
    } catch (error) {
      if (page && !page.isClosed()) {
        const failedPage = page;
        // 수동 생성한 context는 Playwright 기본 실패 첨부 대상이 아니므로 닫기 전에 보존합니다.
        // 진단 자체의 오류가 원래 실패를 덮어쓰지 않도록 각각 처리합니다.
        await Promise.allSettled([
          failedPage.screenshot({ fullPage: true, timeout: 10_000 }).then(body => testInfo.attach(`failure-${iteration}.png`, { contentType: 'image/png', body })),
          Promise.all([failedPage.locator('body').innerText({ timeout: 10_000 }), failedPage.getByRole('alert').allTextContents(), failedPage.content()])
            .then(async ([bodyText, alerts, html]) => {
              await testInfo.attach(`failure-${iteration}.json`, { contentType: 'application/json', body: JSON.stringify({ url: failedPage.url(), iteration, bodyText, alerts, pageErrors: errors }, null, 2) });
              await testInfo.attach(`failure-${iteration}.html`, { contentType: 'text/html', body: html });
            }),
        ]);
      }
      throw error;
    } finally { await context.close(); }
  }
});

import { expect, test } from '@playwright/test';
import { writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cpus, platform, release } from 'node:os';
import { resolve } from 'node:path';
import {
  preparePerformanceFixture, installCatalogFixture, assetPeriodChange,
  FIXTURE_MONTHS, EXPENSES_PER_MONTH, ASSET_COUNT, LOCAL_CURRENCY_BALANCE,
} from './fixtures';
import { measure, type MeasurementOptions } from './measurement';

type ReadyData = { elements: Array<{ selector: string; text?: string; additionalText?: string; count?: number; value?: string; attribute?: [string, string] }>; mark?: string };
// Same serialized predicate as the production-build performance scenario.
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

test('diagnostic only: compare background and search containment with timer observations', async ({ page, context, request }, testInfo) => {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  await installCatalogFixture(context);
  const fixture = await preparePerformanceFixture(page, request);
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    return registration?.active?.state === 'activated' && registration.waiting === null
      && registration.installing === null && navigator.serviceWorker.controller === registration.active;
  }), { timeout: 45_000, intervals: [100, 250, 500] }).toBe(true);
  await page.reload();
  const won = (amount: number) => amount.toLocaleString('ko-KR');
  const expectHome = async () => {
    await expect(page.locator('.calendar-glass')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.balance-card-glass').filter({ hasText: /월 지출/ })).toContainText(won(fixture.monthTotals[0]));
    await expect(page.locator('.balance-card-glass').filter({ hasText: '지역화폐 잔액' })).toContainText(won(LOCAL_CURRENCY_BALANCE));
  };
  const home = async () => { await page.locator('header a[href="/"]').first().click(); await expectHome(); };
  await expectHome();
  const measurements: unknown[] = [];
  const variants = ['realtime-read', 'lite-read'];
  // Rotate every condition through each of the four ordering positions.
  const orders = [0, 1, 0, 1].map(offset => [...variants.slice(offset), ...variants.slice(0, offset)]);
  const metadata = {
    mode: 'diagnostic-only', baselineProductCommit: 'c835a25 plus diagnostic-only runtime choice of same-scope dividend read SDK; search overlay blur disabled in both conditions', commit, buildId: readFileSync(resolve(process.cwd(), '.next/BUILD_ID'), 'utf8').trim(),
    environment: { os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, realDevice: false, backend: 'local Firebase emulators', build: 'existing production Next.js' },
    orders, expectedMeasuredRecords: 32, warmupJourneys: 2,
    cacheCondition: 'same fixture and document; code/SDK warm; closing search disposes its source window, reopening performs a new server query; statistics revisit memory reused',
    timerInterpretation: '16ms interval with absolute performance.now ticks; compare only ticks/gaps against each original measurement startAt/endAt, not locator/setup/confirmation time',
  };
  const output = resolve(process.cwd(), 'performance-results/linux-dividend-transport-diagnostic.json');
  const save = (complete = false) => writeFileSync(output, JSON.stringify({ ...metadata, complete, measurements }, null, 2));
  save();
  const run = async (variant: string, iteration: number, warmup: boolean,
    options: Omit<MeasurementOptions, 'iteration' | 'warmup' | 'browserReady' | 'cacheState'>) => {
    await page.evaluate(() => {
      const state = window as any;
      if (state.__frameDiagnosticTimer) clearInterval(state.__frameDiagnosticTimer.handle);
      const timer = { timeOrigin: performance.timeOrigin, registeredAt: performance.now(), ticks: [] as number[], handle: 0 };
      timer.handle = window.setInterval(() => timer.ticks.push(performance.now()), 16);
      state.__frameDiagnosticTimer = timer;
    });
    let result: any;
    let failure: string | undefined;
    try {
      await measure(page, testInfo, { ...options, iteration, warmup, browserReady: domReady,
        cacheState: 'same-fixture-reopened-search-new-server-window/statistics-revisit-memory' });
      result = await page.evaluate(() => (window as any).__householdPerformance.result);
    } catch (error) { failure = String(error); throw error; }
    finally {
      const timer = await page.evaluate(() => {
        const state = window as any;
        const timer = state.__frameDiagnosticTimer;
        clearInterval(timer.handle);
        delete state.__frameDiagnosticTimer;
        return { timeOrigin: timer.timeOrigin, registeredAt: timer.registeredAt, ticks: timer.ticks, stoppedAt: performance.now(), intervalMs: 16 };
      });
      measurements.push({ variant, iteration, warmup, metric: options.id, result, timer, ...(failure ? { failure } : {}) });
      save();
    }
  };
  const journey = async (variant: string, iteration: number, warmup = false) => {
    const modal = 'div.fixed:has(input[placeholder="지출처명, 메모, 카드명을 검색해보세요"])';
    const styles: Record<string, string> = {
            'search-backdrop-only': 'div.fixed:has(input[placeholder="지출처명, 메모, 카드명을 검색해보세요"]) { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }',
      'home-glass-only': '.balance-card-glass, .calendar-glass { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }',
      'search-and-home-glass': 'div.fixed:has(input[placeholder="지출처명, 메모, 카드명을 검색해보세요"]), .balance-card-glass, .calendar-glass { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }',
      'body-background-scroll': 'body { background-attachment: scroll !important; }',
      'search-containment': `${modal} .overflow-y-auto { contain: layout paint style !important; }`,
      'stable-search-height': `${modal} > div { height: 80vh !important; }`,
      'chart-paint-containment': 'main:has(canvas) { contain: paint !important; }',
    };
    await page.evaluate(useLite => { (globalThis as any).__diagnosticDividendLite = useLite; }, variant === 'lite-read');
    const css = 'div.fixed:has(input[placeholder="지출처명, 메모, 카드명을 검색해보세요"]) { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }';
    const style = css ? await page.addStyleTag({ content: css }) : undefined;
    try {
      await page.locator('header button').first().click();
      const input = page.getByPlaceholder('지출처명, 메모, 카드명을 검색해보세요');
      const search = page.locator('div.fixed').filter({ has: input });
      const summary = `${FIXTURE_MONTHS * EXPENSES_PER_MONTH}건 · ${won(fixture.totalExpenseAmount)}원`;
      await run(variant, iteration, warmup, { id: 'search.first', label: '전체 기간 검색 → 첫 결과·전체 합계', startEvent: 'input',
        action: () => input.fill('성능 원장'), data: { elements: [{ selector: 'div.fixed', text: summary }, { selector: 'div.fixed', text: '성능 원장 00-27' }] },
        ready: async () => { await expect(search.getByText(summary, { exact: true })).toBeVisible(); await expect(search.getByText(/^성능 원장 (?:\d{2}-\d{2}|수정 대상)$/)).toHaveCount(50); },
      });
      await run(variant, iteration, warmup, { id: 'search.change-keyword', label: '검색어 변경 → 새 결과·합계', startEvent: 'input',
        action: () => input.fill('수정 대상'), data: { elements: [{ selector: 'div.fixed', text: `1건 · ${won(fixture.targetAmount)}원` }] },
        ready: async () => { await expect(search.getByText(`1건 · ${won(fixture.targetAmount)}원`, { exact: true })).toBeVisible(); await expect(search.getByText(fixture.targetMerchant, { exact: true })).toBeVisible(); },
      });
      await search.getByRole('button', { name: '닫기', exact: true }).click();
      const yearTotal = fixture.monthTotals.slice(0, 12).reduce((sum, value) => sum + value, 0);
      await run(variant, iteration, warmup, { id: 'expense-stats.revisit', label: '지출 통계 재진입 → 합계·차트', charts: true,
        action: () => page.locator('a[href="/stats"]').click(),
        data: { elements: [{ selector: 'span.text-xl.font-bold', text: `${won(yearTotal)}원` }, { selector: 'canvas', count: 2 }] },
        ready: async () => {
          await expect(page.locator('span.text-xl.font-bold')).toHaveText(`${won(yearTotal)}원`);
          await expect(page.locator('canvas')).toHaveCount(2);
          await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
          await expect(page.locator('main').getByText(/통계를 불러오지 못했습니다|조회 실패|배당금 정보를 불러오지 못했습니다/)).toHaveCount(0);
        },
      });
      await home();
      await page.locator('a[href="/assets"]').click();
      await expect(page.locator('[data-asset-id]')).toHaveCount(ASSET_COUNT);
      await expect(page.locator('p.text-2xl')).toContainText(won(fixture.assetTotal));
      await expect(page.getByText('+0.01% (1,000원)', { exact: true })).toBeVisible();
      await run(variant, iteration, warmup, { id: 'asset-stats.revisit', label: '자산 통계 재진입 → 합계·차트', charts: true,
        action: () => page.locator('a[href="/assets/stats"]').click(), data: { elements: [
          { selector: 'main p', text: assetPeriodChange(fixture, 3) }, { selector: 'p.text-2xl', text: won(fixture.assetTotal) },
          { selector: 'canvas', count: 3 }, { selector: 'span.text-lg.font-bold.text-red-500', text: '데이터 없음' },
        ] },
        ready: async () => {
          await expect(page.getByText(assetPeriodChange(fixture, 3), { exact: true })).toBeVisible();
          await expect(page.locator('canvas')).toHaveCount(3);
          const dividend = page.locator('div.rounded-2xl').filter({ has: page.getByRole('heading', { name: '배당금 현황', exact: true }) }).last();
          await expect(dividend.getByText('데이터 없음', { exact: true })).toBeVisible();
          await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
          await expect(page.locator('main').getByText(/통계를 불러오지 못했습니다|조회 실패|배당금 정보를 불러오지 못했습니다/)).toHaveCount(0);
        },
      });
      await page.locator('header a[href="/assets"]').click();
      await expect(page.locator('[data-asset-id]')).toHaveCount(ASSET_COUNT);
      await home();
    } finally { if (style && !page.isClosed()) await style.evaluate(node => node.remove()); }
  };
  await journey('realtime-read', 0, true);
  await journey('lite-read', 0, true);
  for (let iteration = 0; iteration < orders.length; iteration++) {
    for (const variant of orders[iteration]) await journey(variant, iteration + 1);
  }
  save(true);
});

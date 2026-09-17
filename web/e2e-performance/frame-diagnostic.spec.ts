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

test('diagnostic only: compare search backdrop blur radii', async ({ page, context, request }, testInfo) => {
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
  const variants = ['none', 'half-pixel', 'one-pixel', 'two-pixels', 'four-pixels'];
  // Rotate each condition through all five ordering positions.
  const orders = [0, 1, 2, 3, 4].map(offset => [...variants.slice(offset), ...variants.slice(0, offset)]);
  const metadata = {
    mode: 'diagnostic-only', baselineProductCommit: 'f7194ac', commit, buildId: readFileSync(resolve(process.cwd(), '.next/BUILD_ID'), 'utf8').trim(),
    environment: { os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, realDevice: false, backend: 'local Firebase emulators', build: 'existing production Next.js' },
    orders, expectedMeasuredRecords: 50, warmupJourneys: 1,
    cacheCondition: 'same fixture and document; code/SDK warm; closing search disposes its source window, reopening performs a new server query; search-only comparison',
    timerInterpretation: 'existing optional phase diagnostics only; no additional timer',
  };
  const output = resolve(process.cwd(), 'performance-results/linux-search-blur-radius.json');
  const save = (complete = false) => writeFileSync(output, JSON.stringify({ ...metadata, complete, measurements }, null, 2));
  save();
  const run = async (variant: string, iteration: number, warmup: boolean,
    options: Omit<MeasurementOptions, 'iteration' | 'warmup' | 'browserReady' | 'cacheState'>) => {
    let result: any;
    let failure: string | undefined;
    try {
      await measure(page, testInfo, { ...options, iteration, warmup, browserReady: domReady,
        cacheState: 'same-fixture-reopened-search-new-server-window/statistics-revisit-memory' });
      result = await page.evaluate(() => (window as any).__householdPerformance.result);
    } catch (error) { failure = String(error); throw error; }
    finally {
      measurements.push({ variant, iteration, warmup, metric: options.id, result, ...(failure ? { failure } : {}) });
      save();
    }
  };
  const journey = async (variant: string, iteration: number, warmup = false) => {
    const modal = 'div.fixed:has(input[placeholder="지출처명, 메모, 카드명을 검색해보세요"])';
    const filters: Record<string, string> = { 'none': 'none', 'half-pixel': 'blur(0.5px)', 'one-pixel': 'blur(1px)', 'two-pixels': 'blur(2px)', 'four-pixels': 'blur(4px)' };
    const css = `${modal} { backdrop-filter: ${filters[variant]} !important; -webkit-backdrop-filter: ${filters[variant]} !important; }`;
    const style = css ? await page.addStyleTag({ content: css }) : undefined;
    try {
      await page.locator('header button').first().click();
      const input = page.getByPlaceholder('지출처명, 메모, 카드명을 검색해보세요');
      const search = page.locator('div.fixed').filter({ has: input });
      await expect(search).toHaveCSS('backdrop-filter', filters[variant]);
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
    } finally { if (style && !page.isClosed()) await style.evaluate(node => node.remove()); }
  };
  await journey('none', 0, true);
  for (let iteration = 0; iteration < orders.length; iteration++) {
    for (const variant of orders[iteration]) await journey(variant, iteration + 1);
  }
  save(true);
});

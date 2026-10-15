import { expect, test, type Page, type Request, type Response } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHouseholdThroughUi, observeIndexedDbOpens, readFirestoreCollection, readIndexedDbOpens, resetTestAccount, writeFirestoreFixture } from './emulator';
import { createFinanceHousehold, addCategoryThroughUi, addExpenseThroughUi, seoulDate } from './finance-helpers';

const COMPLETE_PAINT = 'household-account:startup:home:first-complete-paint';

test.describe('첫 홈의 사용 시점 코드 로드', () => {
  // Service Worker precache와 별개로 문서가 실제 요청하는 chunk를 검사합니다.
  test.use({ serviceWorkers: 'block' });

  test('[T-WEBVIEW-004][T-SYS-008][AND-012][SYS-008] iPhone은 첫 홈 뒤 날짜별 내역을 준비하고 반복 날짜 선택·추가·검색·편집과 코드 재시도를 지원한다', async ({ page, request }, testInfo) => {
    await observeIndexedDbOpens(page, true);
    // Resolve each feature from this build's dynamic import manifest. File names and
    // how many shared chunks webpack emits are build details, not this contract.
    const manifest = JSON.parse(readFileSync(path.resolve(process.cwd(), '.next/react-loadable-manifest.json'), 'utf8')) as Record<string, { files: string[] }>;
    const featureImports = ['CategoryDetailModal', 'LocalCurrencyModal', 'expense/AddExpenseModal', 'expense/ExpenseDetail', 'expense/IncomeSummaryModal', 'search/SearchModal'];
    const featureChunks = Object.fromEntries(featureImports.map(feature => {
      const entry = Object.entries(manifest).find(([key]) => key.replaceAll('\\', '/').endsWith(`LedgerPage.tsx -> @/components/${feature}`));
      expect(entry, `${feature}의 실제 지연 import가 manifest에 있어야 합니다.`).toBeDefined();
      const files = entry![1].files.filter(file => file.endsWith('.js')).map(file => path.posix.basename(file));
      expect(files.length, `${feature}에는 사용 시 로드할 코드가 있어야 합니다.`).toBeGreaterThan(0);
      return [feature, files];
    }));
    const deferredChunks = Array.from(new Set(Object.values(featureChunks).flat()));
    const detailChunks = featureChunks['expense/ExpenseDetail'];
    const searchChunks = featureChunks['search/SearchModal'].filter(file => !detailChunks.includes(file));
    expect(searchChunks.length, '검색을 열기 전에 별도로 로드해야 할 코드가 있어야 합니다.').toBeGreaterThan(0);
    const requestedChunks: string[] = [];
    page.on('request', request => {
      if (request.resourceType() === 'script') requestedChunks.push(new URL(request.url()).pathname.split('/').at(-1)!);
    });
    await createFinanceHousehold(page, request);
    await expect.poll(() => page.evaluate(name => performance.getEntriesByName(name).length, COMPLETE_PAINT)).toBe(1);
    expect(requestedChunks.filter(file => deferredChunks.includes(file) && !detailChunks.includes(file)), '다른 닫힌 기능은 사용 전에 요청하지 않아야 합니다.').toEqual([]);
    // 요청 이벤트는 시작에 발생하지만 Resource Timing은 응답 완료 뒤에 추가됩니다.
    await expect.poll(() => page.evaluate(files => {
      const completed = performance.getEntriesByType('resource').map(entry => new URL(entry.name).pathname.split('/').at(-1));
      return files.every(file => completed.includes(file));
    }, detailChunks)).toBe(true);
    const detailTiming = await page.evaluate(({ files, mark }) => ({
      requests: performance.getEntriesByType('resource').filter(entry => files.includes(new URL(entry.name).pathname.split('/').at(-1)!)).map(entry => ({ file: new URL(entry.name).pathname.split('/').at(-1)!, requestedAt: entry.startTime })),
      paintedAt: performance.getEntriesByName(mark)[0].startTime,
    }), { files: detailChunks, mark: COMPLETE_PAINT });
    // Shared code may already be loaded; the feature must start preparing after paint.
    expect(detailTiming.requests.some(entry => entry.requestedAt >= detailTiming.paintedAt)).toBe(true);
    await expect(page.locator('head link[rel="preconnect"][href$="googleapis.com"]')).toHaveCount(0);
    const initialScripts = [...requestedChunks];

    await page.getByTestId(/^calendar-day-/).first().click();
    await page.getByRole('button', { name: '지출 추가', exact: true }).click();
    const add = page.getByRole('dialog', { name: '지출 추가', exact: true });
    await add.getByPlaceholder('가맹점명을 입력하세요').fill('첫 사용 코드 검사');
    await add.locator('input[type="number"]').fill('12300');
    await expect(add.getByPlaceholder('가맹점명을 입력하세요')).toHaveValue('첫 사용 코드 검사');
    await add.getByRole('button', { name: '기타', exact: true }).click();
    await add.getByRole('button', { name: '추가', exact: true }).click();
    const expense = page.getByTestId('expense-item').filter({ hasText: '첫 사용 코드 검사' });
    await expect(expense).toContainText('12,300원');
    for (const feature of ['expense/ExpenseDetail', 'expense/AddExpenseModal']) {
      expect(featureChunks[feature].every(file => requestedChunks.includes(file))).toBe(true);
    }

    // Observe even short-lived fallback DOM, not just the final settled screen.
    await page.evaluate(() => {
      const state = window as typeof window & { dateDetailLoadingInsertions?: number };
      state.dateDetailLoadingInsertions = 0;
      new MutationObserver(records => {
        for (const record of records) for (const node of Array.from(record.addedNodes)) {
          if (node.textContent?.includes('날짜별 내역 화면을 불러오는 중입니다.')) state.dateDetailLoadingInsertions! += 1;
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    const firstDay = page.getByTestId(/^calendar-day-/).first();
    await page.getByTestId(/^calendar-day-/).nth(1).click();
    await expect(page.getByRole('button', { name: '지출 추가', exact: true })).toBeVisible();
    await expect(expense).toHaveCount(0);
    await firstDay.click();
    await expect(expense).toContainText('12,300원');
    await firstDay.click();
    await expect(page.getByRole('button', { name: '지출 추가', exact: true })).toHaveCount(0);
    await firstDay.click();
    await expect(expense).toContainText('12,300원');
    const repeatedDateLoading = await page.evaluate(() =>
      (window as typeof window & { dateDetailLoadingInsertions?: number }).dateDetailLoadingInsertions);
    expect(repeatedDateLoading).toBe(0);
    for (const file of detailChunks) expect(requestedChunks.filter(requested => requested === file)).toHaveLength(1);

    let abortedSearchChunk: string | undefined;
    await page.route(url => searchChunks.includes(url.pathname.split('/').at(-1)!), route => {
      if (abortedSearchChunk !== undefined) return route.continue();
      abortedSearchChunk = route.request().url().split('/').at(-1)!;
      return route.abort('failed');
    });
    await page.getByRole('button', { name: '검색', exact: true }).click();
    const loadError = page.getByRole('alert').filter({ hasText: '검색 화면을 불러오지 못했습니다.' });
    await expect(loadError).toBeVisible();
    await expect(expense).toContainText('12,300원');
    await loadError.getByRole('button', { name: '다시 시도', exact: true }).click();
    const input = page.getByPlaceholder('지출처명, 메모, 카드명, 태그 검색');
    await input.fill('첫 사용 코드 검사');
    expect(abortedSearchChunk).toBeDefined();
    expect(requestedChunks.filter(file => file === abortedSearchChunk)).toHaveLength(2);
    const search = page.locator('div.fixed').filter({ has: input });
    await search.getByText('첫 사용 코드 검사', { exact: true }).click();
    const edit = page.getByRole('dialog', { name: '지출 수정', exact: true });
    await edit.locator('input[type="number"]').fill('15400');
    await edit.getByPlaceholder('메모를 입력하세요').fill('늦게 로드한 편집 저장');
    await edit.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByText('1건 · 15,400원', { exact: true })).toBeVisible();
    await expect.poll(async () => {
      const households = await readFirestoreCollection(request, 'households');
      const householdId = households[0].name.split('/').at(-1)!;
      const transactions = await readFirestoreCollection(request, `households/${householdId}/ledgerTransactions`);
      return transactions.some(doc => doc.fields?.merchant?.stringValue === '첫 사용 코드 검사'
        && Number(doc.fields?.amountInWon?.integerValue) === 15400
        && doc.fields?.memo?.stringValue === '늦게 로드한 편집 저장');
    }).toBe(true);
    await testInfo.attach('home-deferred-production-chunks', {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ deferredChunks, initialScripts, requestedChunks, abortedSearchChunk, detailTiming, repeatedDateLoading }, null, 2)),
    });
  });
});

function isAppVisit(request: Request): boolean {
  return request.method() === 'POST'
    && request.url().endsWith('/executeHouseholdCommand')
    && request.postDataJSON()?.data?.command === 'access.record-app-visit.v1';
}

function observeAppVisits(page: Page) {
  const requests: Request[] = [];
  const responses: Response[] = [];
  // 요청을 변경하거나 응답을 대체하지 않고 실제 SDK 전송만 관찰합니다.
  page.on('request', (request) => { if (isAppVisit(request)) requests.push(request); });
  page.on('response', (response) => { if (isAppVisit(response.request())) responses.push(response); });
  return { requests, responses };
}

async function acceptedAppVisit(observed: ReturnType<typeof observeAppVisits>) {
  await expect.poll(() => observed.responses.length, {
    message: '실제 접속 Command가 서버 응답까지 완료되어야 합니다.',
  }).toBe(1);
  expect(observed.requests).toHaveLength(1);
  const response = observed.responses[0];
  expect(response.ok()).toBe(true);
  const envelope = response.request().postDataJSON().data;
  const body = await response.json();
  expect(body.error).toBeUndefined();
  expect(body.result.contractVersion).toBe('household-command-response.v1');
  expect(body.result.commandId).toBe(envelope.commandId);
  expect(body.result.result.kind).toBe('succeeded');
  expect(body.result.result.value.kind).toBe('recorded');
  expect(envelope.payload.platform).toBe('ios-pwa');
  return envelope.payload as {
    visitId: string;
    clientStartupDurationMs: number;
    clientStartupDiagnostics?: {
      version: number;
      webBuild?: string;
      navigationType?: string;
      initialVisibility: string;
      visibilityTrackingStartedAtMs: number;
      hiddenMs: number;
      hiddenCount: number;
      serviceWorkerControlled?: boolean;
      yearSummaryRequired?: boolean;
      cache?: { bootstrap?: string; membership?: string; household?: string };
      timingsMs: Record<string, number>;
    };
  };
}

function expectServerReadinessOrder(timings: Record<string, number>) {
  for (const [source, ready] of [
    ['ledger', 'ledgerReady'], ['categories', 'categoriesReady'],
    ['currencyPreferences', 'localCurrencyReady'], ['currencyBalances', 'localCurrencyReady'],
  ]) {
    const initial = timings[source + 'InitialReadReceived'] !== undefined && timings[source + 'InitialReadFallback'] === undefined;
    const started = source + (initial ? 'InitialReadStarted' : 'ListenStarted');
    const received = source + (initial ? 'InitialReadReceived' : 'ServerSnapshotReceived');
    for (const key of [started, received, ready, 'homeReady']) {
      expect(timings, key + '의 실제 SDK 또는 React 준비 관측이 있어야 합니다.').toHaveProperty(key);
    }
    expect(timings[received]).toBeGreaterThanOrEqual(timings[started]);
    expect(timings[ready]).toBeGreaterThanOrEqual(timings[received]);
    expect(timings.homeReady).toBeGreaterThanOrEqual(timings[ready]);
  }
}

test.beforeEach(async () => { await resetTestAccount(); });

test.describe('첫 홈 별도 서버 조회', () => {
  test.use({ serviceWorkers: 'block' });
  test('[T-LED-001] 가구명이 없는 첫 시작은 앱 이름을 JS 청크보다 먼저 표시한다', async ({ page }) => {
    let releaseChunks!: () => void;
    const chunksHeld = new Promise<void>(resolve => { releaseChunks = resolve; });
    let heldChunks = 0;
    await page.route('**/_next/static/**/*.js', async route => {
      heldChunks += 1;
      await chunksHeld;
      await route.continue();
    });
    try {
      await page.goto('/', { waitUntil: 'commit' });
      await expect.poll(() => heldChunks).toBeGreaterThan(0);
      await expect(page.getByRole('status').getByRole('heading', { name: '모두의 가계부', exact: true })).toBeVisible();
      await expect(page.getByRole('status').locator('img')).toBeVisible();
      await expect(page.locator('.calendar-glass')).toHaveCount(0);
    } finally {
      releaseChunks();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
  test('[T-ADM-005][T-WEBVIEW-004] 실제 Lite 지연 응답도 반영하여 Listen보다 먼저 홈을 표시한다', async ({ page, context, request }) => {
    await observeIndexedDbOpens(page, true);
    await createFinanceHousehold(page, request);
    await page.close();
    const restarted = await context.newPage();
    await observeIndexedDbOpens(restarted, true);
    const visits = observeAppVisits(restarted);
    let releaseRest!: () => void, releaseListen!: () => void;
    const restGate = new Promise<void>(resolve => { releaseRest = resolve; });
    const listenGate = new Promise<void>(resolve => { releaseListen = resolve; });
    let restHeld = 0, listensHeld = 0;
    await restarted.route(/\/documents(?::batchGet|(?:\/[^?]+)?:runQuery)/, async route => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      restHeld += 1;
      await restGate;
      await route.fulfill({ response });
    });
    await restarted.route('**/google.firestore.v1.Firestore/Listen/channel**', async route => {
      listensHeld += 1;
      await listenGate;
      await route.continue();
    });
    try {
      await restarted.goto('/');
      await expect.poll(() => restHeld).toBeGreaterThanOrEqual(4);
      await expect.poll(() => listensHeld).toBeGreaterThan(0);
      // Both former per-source limits (750ms / 2s) pass while real responses remain held.
      await restarted.waitForTimeout(2500);
      await expect(restarted.locator('.calendar-glass')).toHaveCount(0);
      releaseRest();
      await expect.poll(() => restarted.evaluate(() => performance.getEntriesByType('resource')
        .filter(entry => /\/documents(?::batchGet|(?:\/[^?]+)?:runQuery)/.test(entry.name)).length)).toBeGreaterThanOrEqual(4);
      await expect(restarted.locator('.calendar-glass')).toHaveAttribute('aria-busy', 'false');
      const timings = (await acceptedAppVisit(visits)).clientStartupDiagnostics!.timingsMs;
      for (const source of ['ledger', 'categories', 'currencyPreferences', 'currencyBalances']) {
        expect(timings[source + 'InitialReadCompleted'] - timings[source + 'InitialReadStarted']).toBeGreaterThanOrEqual(2500);
        expect(timings[source + 'InitialReadReceived']).toBeGreaterThanOrEqual(timings[source + 'InitialReadCompleted']);
        expect(timings[source + 'ListenStarted']).toBeGreaterThanOrEqual(timings[source + 'InitialReadReceived']);
        expect(timings).not.toHaveProperty(source + 'InitialReadFallback');
        expect(timings).not.toHaveProperty(source + 'ServerSnapshotReceived');
      }
    } finally {
      releaseRest(); releaseListen();
      await restarted.unrouteAll({ behavior: 'wait' });
    }
  });

  test('[T-LED-001][T-WEBVIEW-004] 첫 홈 무응답은 오류를 표시하고 재시도하면 새 문서의 최신 값으로 복구한다', async ({ page, context, request }, testInfo) => {
    await observeIndexedDbOpens(page, true);
    const householdId = await createFinanceHousehold(page, request);
    await page.close();
    await writeFirestoreFixture(request, `households/${householdId}/homePreferences/home`, {
      left: { stringValue: 'MONTHLY_EXPENSE' }, right: { stringValue: 'LOCAL_CURRENCY_BALANCE' },
      aggregateVersion: { integerValue: '1' }, selectedLocalCurrencyType: { stringValue: 'gyeonggi' },
    });
    const balancePath = `households/${householdId}/localCurrencyBalances/gyeonggi`;
    const balanceFields = (amount: number) => ({
      localCurrencyType: { stringValue: 'gyeonggi' }, balanceInWon: { integerValue: String(amount) },
    });
    await writeFirestoreFixture(request, balancePath, balanceFields(36890));
    const restarted = await context.newPage();
    await observeIndexedDbOpens(restarted, true);
    const visits = observeAppVisits(restarted);
    let holdFirstDocument = true, heldResponses = 0, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await restarted.route(/\/documents(?::batchGet|(?:\/[^?]+)?:runQuery)/, async route => {
      if (!holdFirstDocument || !route.request().postData()?.includes('localCurrencyBalances')) return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      heldResponses += 1;
      await gate;
      await route.fulfill({ response });
    });
    try {
      await restarted.goto('/');
      const firstDocument = await restarted.evaluate(() => performance.timeOrigin);
      await expect.poll(() => heldResponses).toBe(1);
      const loading = restarted.getByRole('status');
      await expect(loading).toHaveAttribute('aria-busy', 'true');
      await expect(loading.locator('.sr-only')).toHaveText('로딩중...');
      await expect(loading.getByRole('heading', { name: '재무 E2E 가구네', exact: true })).toBeVisible();
      await expect(loading.getByText('가계부 · 자산', { exact: true })).toBeVisible();
      await expect(restarted.locator('.calendar-glass')).toHaveCount(0);
      const loadError = restarted.getByRole('main').getByRole('alert');
      await expect(loadError).toHaveText('가계부를 불러오지 못했습니다.다시 시도');
      const elapsedAtError = await restarted.evaluate(() => performance.now());
      expect(elapsedAtError).toBeGreaterThanOrEqual(20000);
      expect(await restarted.evaluate(name => performance.getEntriesByName(name).length, COMPLETE_PAINT)).toBe(0);
      expect(visits.requests).toHaveLength(0);
      await writeFirestoreFixture(request, balancePath, balanceFields(47901));
      holdFirstDocument = false;
      await Promise.all([
        restarted.waitForEvent('domcontentloaded'),
        loadError.getByRole('button', { name: '다시 시도', exact: true }).click(),
      ]);
      release();
      expect(await restarted.evaluate(() => performance.timeOrigin)).not.toBe(firstDocument);
      await expect(restarted.locator('.calendar-glass')).toHaveAttribute('aria-busy', 'false');
      const balance = restarted.locator('.balance-card-glass').filter({ hasText: '지역화폐 잔액' });
      await expect(balance).toContainText('47,901');
      await expect(balance).not.toContainText('36,890');
      await expect(loadError).toHaveCount(0);
      const visit = await acceptedAppVisit(visits);
      expectServerReadinessOrder(visit.clientStartupDiagnostics!.timingsMs);
      expect(await restarted.evaluate(name => performance.getEntriesByName(name).length, COMPLETE_PAINT)).toBe(1);
      await testInfo.attach('home-timeout-retry', { contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ heldResponses, elapsedAtError, timings: visit.clientStartupDiagnostics!.timingsMs }, null, 2)) });
    } finally {
      release();
      await restarted.unrouteAll({ behavior: 'wait' });
    }
  });

  for (const householdName of ['또니망고네', '익태송희네']) {
    test(`[T-LED-001][T-HOME-003][T-WEBVIEW-004] ${householdName} 첫 홈은 마지막 잔액 응답까지 기다려 예산·잔액·날짜별 금액을 함께 표시한다`, async ({ page, context, request }, testInfo) => {
      await observeIndexedDbOpens(page, true);
      const { householdId } = await createHouseholdThroughUi(page, householdName, '재무 테스터');
      await addCategoryThroughUi(page, request, '첫 화면 예산', 100000);
      await addExpenseThroughUi(page, request, { merchant: '전체 준비 검사', category: '첫 화면 예산', amount: 12300, date: seoulDate(0, 1) });
      await page.close();
      await writeFirestoreFixture(request, `households/${householdId}/homePreferences/home`, {
        left: { stringValue: 'MONTHLY_REMAINING_BUDGET' }, right: { stringValue: 'LOCAL_CURRENCY_BALANCE' },
        aggregateVersion: { integerValue: '1' }, selectedLocalCurrencyType: { stringValue: 'gyeonggi' },
      });
      const balancePath = `households/${householdId}/localCurrencyBalances/gyeonggi`;
      await writeFirestoreFixture(request, balancePath, {
        localCurrencyType: { stringValue: 'gyeonggi' }, balanceInWon: { integerValue: '36890' },
      });
      const restarted = await context.newPage();
      await observeIndexedDbOpens(restarted, true);
      await restarted.addInitScript(() => {
        const phases: string[] = [];
        const titleFrames: string[] = [];
        Object.assign(window, { homeStartupFrames: phases, startupTitleFrames: titleFrames });
        const observeFrame = () => {
          const loading = document.querySelector('[role="status"][aria-busy="true"]');
          const artwork = loading?.querySelector('img');
          if (artwork?.complete && artwork.naturalWidth > 0) titleFrames.push(loading?.querySelector('h1')?.textContent ?? '');
          const complete = document.querySelector('.calendar-glass') && document.querySelectorAll('.balance-card-glass').length === 2;
          const phase = complete ? 'home' : loading?.querySelector('.sr-only')?.textContent === '로딩중...' ? 'loading' : 'gap';
          if ((phases.length > 0 || phase === 'loading') && phases.at(-1) !== phase) phases.push(phase);
          if (!complete) requestAnimationFrame(observeFrame);
        };
        requestAnimationFrame(observeFrame);
      });
      let releaseAuth!: () => void;
      const authHeld = new Promise<void>(resolve => { releaseAuth = resolve; });
      let heldAuthResponses = 0;
      let firestoreReads = 0;
      let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      let heldBalanceResponses = 0;
      let releaseChunks!: () => void;
      const chunksHeld = new Promise<void>(resolve => { releaseChunks = resolve; });
      let heldChunks = 0;
      let releaseParser!: () => void;
      const parserHeld = new Promise<void>(resolve => { releaseParser = resolve; });
      let heldParserResponses = 0;
      const hydrationErrors: string[] = [];
      restarted.on('pageerror', error => hydrationErrors.push(error.message));
      restarted.on('console', message => {
        if (message.type() === 'error' && /hydration|server HTML|did not match|Content Security Policy|Refused to execute.*script|Minified React error #4(?:18|19|21|22|23|25)/i.test(message.text())) hydrationErrors.push(message.text());
      });
      await restarted.route('**/_next/static/**/*.js', async route => {
        heldChunks += 1;
        await chunksHeld;
        await route.continue();
      });
      // Pause HTML parsing immediately before the name initializer, as a split response can.
      // Only this temporary parser pause is injected; production markup, CSP and artwork are used.
      await restarted.route('**/__e2e_startup_parser_pause.js', async route => {
        heldParserResponses += 1;
        await parserHeld;
        await route.fulfill({ contentType: 'application/javascript', body: 'document.currentScript.remove();' });
      });
      await restarted.route(url => url.pathname === '/', async route => {
        if (!route.request().isNavigationRequest()) return route.continue();
        const response = await route.fetch();
        const html = await response.text();
        const initializer = /<script[^>]*data-startup-household-name[^>]*>/;
        expect(html.match(initializer)).not.toBeNull();
        await route.fulfill({ response, body: html.replace(initializer,
          match => `<script src="/__e2e_startup_parser_pause.js"></script>${match}`) });
      });
      // UI가 저장한 가구명은 실제 Auth 복원 응답보다 먼저 표시하고, 조회 권한으로 쓰지 않습니다.
      await restarted.route('**/identitytoolkit.googleapis.com/v1/accounts:lookup?*', async route => {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        heldAuthResponses += 1;
        await authHeld;
        await route.fulfill({ response });
      });
      // 실제 Lite 잔액 응답과 live 전달을 보류하여 일부 준비만으로 홈이 뜨지 않는지 확인합니다.
      await restarted.route('**/google.firestore.v1.Firestore/Listen/channel**', async route => {
        firestoreReads += 1;
        await held;
        await route.continue();
      });
      await restarted.route(/\/documents(?::batchGet|(?:\/[^?]+)?:runQuery)/, async route => {
        firestoreReads += 1;
        if (!route.request().postData()?.includes('localCurrencyBalances')) return route.continue();
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        heldBalanceResponses += 1;
        await held;
        await route.fulfill({ response });
      });
      try {
        const documentResponse = await restarted.goto('/', { waitUntil: 'commit' });
        expect(await documentResponse!.text(), '서버 HTML에 기기별 가구명을 포함하면 안 됩니다.').not.toContain(householdName);
        await expect.poll(() => heldParserResponses).toBe(1);
        await expect(restarted.getByRole('status').locator('img'), '이름 초기화 전 파서가 멈춰도 그림만 먼저 표시하면 안 됩니다.').not.toBeVisible();
        releaseParser();
        await expect.poll(() => heldChunks).toBeGreaterThan(0);
        await expect(restarted.getByRole('heading', { name: householdName })).toBeVisible();
        await expect.poll(() => restarted.evaluate(() => (window as typeof window & { startupTitleFrames: string[] }).startupTitleFrames.length)).toBeGreaterThan(0);
        const firstTitleFrames = await restarted.evaluate(() => (window as typeof window & { startupTitleFrames: string[] }).startupTitleFrames);
        await testInfo.attach('startup-first-title-frames', { contentType: 'application/json',
          body: Buffer.from(JSON.stringify({ householdName, firstTitleFrames, heldParserResponses, heldChunks }, null, 2)) });
        expect(firstTitleFrames.every(name => name === householdName), 'JS 청크를 받기 전 그림의 첫 frame에도 가구명이 함께 보여야 합니다.').toBe(true);
        expect(heldAuthResponses).toBe(0);
        expect(firestoreReads).toBe(0);
        releaseChunks();
        await expect.poll(() => heldAuthResponses).toBeGreaterThan(0);
        await expect(restarted.getByRole('heading', { name: householdName })).toBeVisible();
        await expect(restarted.getByRole('status').locator('img')).toBeVisible();
        const beforeAuthMarks = await restarted.evaluate(() => performance.getEntriesByType('mark').map(entry => entry.name));
        expect(beforeAuthMarks).toContain('household-account:startup:auth:started');
        for (const phase of ['auth:ready', 'membership:started', 'household:started', 'ledger:ready']) {
          expect(beforeAuthMarks).not.toContain(`household-account:startup:${phase}`);
        }
        expect(firestoreReads, '표시용 가구명만으로 인증 전 원장 조회를 시작하면 안 됩니다.').toBe(0);
        await expect(restarted.locator('.calendar-glass')).toHaveCount(0);
        releaseAuth();
        await expect.poll(() => heldBalanceResponses).toBeGreaterThan(0);
        await expect.poll(() => restarted.evaluate(() => ['ledger:ready', 'categories:ready'].every(phase =>
          performance.getEntriesByName(`household-account:startup:${phase}`).length === 1))).toBe(true);
        await expect(restarted.getByRole('status')).toHaveAttribute('aria-busy', 'true');
        await expect(restarted.getByRole('status')).toContainText('로딩중...');
        await expect(restarted.getByRole('heading', { name: householdName })).toBeVisible();
        await expect(restarted.getByRole('status').getByText('가계부 · 자산')).toBeVisible();
        await restarted.evaluate(() => document.fonts.ready);
        const artwork = restarted.getByRole('status').locator('img');
        await expect(artwork).toBeVisible();
        await expect.poll(() => artwork.evaluate((image: HTMLImageElement) =>
          image.complete && image.naturalWidth === 1254 && image.naturalHeight === 1254)).toBe(true);
        const viewport = restarted.viewportSize()!;
        const artworkLayouts = [];
        for (const size of [
          { name: 'mobile', width: 390, height: 844, fit: 'contain' },
          { name: 'reference', width: 360, height: 640, fit: 'contain' },
          { name: 'narrow-mobile', width: 360, height: 960, fit: 'contain' },
          { name: 'small-window', width: 240, height: 640, fit: 'contain' },
          { name: 'landscape', width: 844, height: 390, fit: 'contain' },
          { name: 'desktop', width: 1280, height: 800, fit: 'contain' },
        ]) {
          await restarted.setViewportSize({ width: size.width, height: size.height });
          await expect(artwork).toHaveCSS('object-fit', size.fit);
          await expect(restarted.getByRole('status')).toHaveCSS('position', 'fixed');
          const layout = await artwork.evaluate((image: HTMLImageElement) => {
            const box = image.getBoundingClientRect();
            const root = image.closest('[role="status"]')!;
            const screen = root.getBoundingClientRect();
            const title = root.querySelector('h1')!.getBoundingClientRect();
            const subtitle = root.querySelector('p')!.getBoundingClientRect();
            const group = image.parentElement!.getBoundingClientRect();
            const titleStyle = getComputedStyle(root.querySelector('h1')!);
            const subtitleStyle = getComputedStyle(root.querySelector('p')!);
            const dots = root.querySelector('.startup-dots')!.getBoundingClientRect();
            return { x: box.x, width: box.width, height: box.height,
              padding: parseFloat(getComputedStyle(root).paddingLeft),
              screenWidth: screen.width, screenHeight: screen.height,
              groupTop: group.top, groupBottom: group.bottom,
              subtitleGap: subtitle.top - title.bottom, titleHeight: title.height,
              titleFontSize: parseFloat(titleStyle.fontSize), subtitleFontSize: parseFloat(subtitleStyle.fontSize),
              subtitleWeight: subtitleStyle.fontWeight, subtitleFamily: subtitleStyle.fontFamily,
              dotsTop: dots.top, dotsBottomInset: screen.bottom - dots.bottom,
              physicalWidth: box.width * devicePixelRatio,
              fontLoaded: document.fonts.check(`30px ${getComputedStyle(root.querySelector('h1')!).fontFamily}`) };
          });
          expect(layout.padding).toBe(24);
          expect(layout.x + layout.width / 2).toBeCloseTo(layout.screenWidth / 2, 1);
          expect(layout.width).toBeCloseTo(layout.screenHeight < 400 ? 120 : Math.min(size.width * .5077, 198), 1);
          expect(layout.height).toBeCloseTo(layout.width, 1);
          expect(layout.physicalWidth).toBeLessThanOrEqual(1254);
          expect(layout.groupTop).toBeGreaterThanOrEqual(24 - 0.05);
          expect(layout.groupBottom).toBeLessThanOrEqual(layout.screenHeight - 24 + 0.05);
          expect(layout.titleHeight).toBeCloseTo(layout.titleFontSize * 4 / 3, 1);
          expect(layout.subtitleGap).toBeCloseTo(8, 1);
          expect(layout.titleFontSize).toBeCloseTo(Math.max(24, Math.min(size.width * .0846, 33)), 1);
          expect(layout.subtitleFontSize).toBeCloseTo(Math.max(14, Math.min(size.width * .0436, 17)), 1);
          expect(layout.subtitleWeight).toBe('700');
          expect(layout.subtitleFamily).toBe('sans-serif');
          expect(layout.dotsTop).toBeGreaterThan(layout.groupBottom + 16);
          expect(layout.dotsBottomInset).toBeCloseTo(size.height < 400 ? 24 : 64, 1);
          expect(layout.fontLoaded).toBe(true);
          artworkLayouts.push({ ...size, ...layout });
          await restarted.screenshot({ path: testInfo.outputPath(`startup-brand-${size.name}.png`) });
        }
        await restarted.setViewportSize(viewport);
        await expect(restarted.locator('.calendar-glass')).toHaveCount(0);
        await expect(restarted.locator('.balance-card-glass')).toHaveCount(0);
        expect(await restarted.evaluate(() => performance.getEntriesByName('household-account:startup:ledger:first-paint').length)).toBe(0);
        expect(await restarted.evaluate(name => performance.getEntriesByName(name).length, COMPLETE_PAINT)).toBe(0);
        release();
        const calendar = restarted.locator('.calendar-glass');
        const budget = restarted.locator('.balance-card-glass').filter({ hasText: '월 잔여 예산' });
        const balance = restarted.locator('.balance-card-glass').filter({ hasText: '지역화폐 잔액' });
        await expect(calendar).toHaveAttribute('aria-busy', 'false');
        await expect(budget).toContainText('87,700');
        await expect(balance).toContainText('36,890');
        await expect(restarted.getByTestId(`calendar-day-${seoulDate(0, 1)}`)).toContainText('12,300');
        await expect(restarted.getByText('가계부를 불러오는 중입니다.', { exact: true })).toHaveCount(0);
        await expect.poll(() => restarted.evaluate(name => performance.getEntriesByName(name).length, COMPLETE_PAINT)).toBe(1);
        const frames = await restarted.evaluate(() => (window as typeof window & { homeStartupFrames: string[] }).homeStartupFrames);
        expect(frames, '인증 대기부터 첫 홈까지 빈 화면이나 다른 로딩 단계를 거치면 안 됩니다.').toEqual(['loading', 'home']);
        await expect(restarted.getByText('로딩중...', { exact: true })).toHaveCount(0);
        const originalCalendar = await calendar.elementHandle();
        await writeFirestoreFixture(request, balancePath, {
          localCurrencyType: { stringValue: 'gyeonggi' }, balanceInWon: { integerValue: '0' },
        });
        await expect(balance.getByText('0', { exact: true })).toBeVisible();
        expect(await originalCalendar!.evaluate(node => node.isConnected)).toBe(true);
        const marks = await restarted.evaluate(() => Object.fromEntries(performance.getEntriesByType('mark')
          .filter(entry => entry.name.startsWith('household-account:startup:')).map(entry => [entry.name, entry.startTime])));
        expect(marks['household-account:startup:ledger:first-paint']).toBeGreaterThanOrEqual(marks['household-account:startup:local-currency:ready']);
        expect(hydrationErrors).toEqual([]);
        await testInfo.attach('home-initial-complete-display', { contentType: 'application/json',
          body: Buffer.from(JSON.stringify({ heldParserResponses, heldChunks, firstTitleFrames, hydrationErrors, heldAuthResponses, beforeAuthMarks, heldBalanceResponses, marks, frames, artworkLayouts }, null, 2)) });
      } finally {
        releaseParser();
        releaseChunks();
        releaseAuth();
        release();
        await restarted.unrouteAll({ behavior: 'wait' });
      }
    });
  }

  test('[T-WEBVIEW-004][T-SYS-008][T-ADM-005][AND-012] 실제 Listen 대기 중 Lite로 최신 홈을 표시하고 구독 전환 뒤 변경·삭제를 반영한다', async ({ page, context, request }, testInfo) => {
    await observeIndexedDbOpens(page, true);
    const householdId = await createFinanceHousehold(page, request);
    const transaction = await addExpenseThroughUi(page, request, { merchant: '첫 조회 전환', amount: 12300, date: seoulDate(0, 1) });
    await expect.poll(() => page.evaluate(name => performance.getEntriesByName(name).length, COMPLETE_PAINT)).toBe(1);
    await page.close();
    await writeFirestoreFixture(request, `households/${householdId}/homePreferences/home`, {
      left: { stringValue: 'MONTHLY_EXPENSE' }, right: { stringValue: 'LOCAL_CURRENCY_BALANCE' },
      aggregateVersion: { integerValue: '1' }, selectedLocalCurrencyType: { stringValue: 'gyeonggi' },
    });
    await writeFirestoreFixture(request, `households/${householdId}/localCurrencyBalances/gyeonggi`, {
      localCurrencyType: { stringValue: 'gyeonggi' }, balanceInWon: { integerValue: '36890' },
    });
    const restarted = await context.newPage();
    await observeIndexedDbOpens(restarted, true);
    const visits = observeAppVisits(restarted);
    await restarted.addInitScript(paintMark => {
      const observation = { frames: [] as { phase: string; atMs: number }[], paintWhileLoading: false };
      Object.assign(window, { startupDisplayObservation: observation });
      const observeFrame = () => {
        const loading = document.querySelector('[role="status"][aria-busy="true"]');
        const home = document.querySelector('.calendar-glass');
        const painted = performance.getEntriesByName(paintMark).length > 0;
        const phase = home ? 'home' : loading ? 'loading' : 'gap';
        if ((observation.frames.length > 0 || phase === 'loading') && observation.frames.at(-1)?.phase !== phase) {
          observation.frames.push({ phase, atMs: performance.now() });
        }
        if (loading && painted) observation.paintWhileLoading = true;
        if (!painted) requestAnimationFrame(observeFrame);
      };
      requestAnimationFrame(observeFrame);
    }, COMPLETE_PAINT);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let heldRequests = 0;
    const restResponses: string[] = [];
    restarted.on('response', response => {
      if (/\/documents(?:\/[^?]+)?:runQuery|\/documents:batchGet/.test(response.url()) && response.ok()) {
        restResponses.push(new URL(response.url()).pathname.split(':').at(-1)!);
      }
    });
    await restarted.route('**/google.firestore.v1.Firestore/Listen/channel**', async route => {
      heldRequests += 1;
      await held;
      await route.continue();
    });
    try {
      await restarted.goto('/');
      await expect(restarted.locator('.calendar-glass')).toHaveAttribute('aria-busy', 'false');
      const monthly = restarted.locator('.balance-card-glass').filter({ hasText: /월 지출/ });
      await expect(monthly).toContainText('12,300');
      await expect(restarted.locator('.balance-card-glass').filter({ hasText: '지역화폐 잔액' })).toContainText('36,890');
      await restarted.getByTestId(/^calendar-day-/).first().click();
      const expense = restarted.getByTestId('expense-item').filter({ hasText: '첫 조회 전환' });
      await expect(expense).toContainText('12,300원');
      await expect(expense.getByText('기타', { exact: true })).toBeVisible();
      const visit = await acceptedAppVisit(visits);
      const timings = visit.clientStartupDiagnostics!.timingsMs;
      expectServerReadinessOrder(timings);
      const display = await restarted.evaluate(paintMark => ({
        ...(window as typeof window & { startupDisplayObservation: {
          frames: { phase: string; atMs: number }[]; paintWhileLoading: boolean;
        } }).startupDisplayObservation,
        homeReadyAt: performance.getEntriesByName('household-account:startup:home:ready')[0].startTime,
        paintedAt: performance.getEntriesByName(paintMark)[0].startTime,
      }), COMPLETE_PAINT);
      expect(display.frames.map(frame => frame.phase)).toEqual(['loading', 'home']);
      const homeAt = display.frames.find(frame => frame.phase === 'home')!.atMs;
      expect(homeAt).toBeGreaterThanOrEqual(2000);
      expect(display.paintWhileLoading).toBe(false);
      expect(display.paintedAt).toBeGreaterThanOrEqual(homeAt);
      expect(display.paintedAt).toBeGreaterThanOrEqual(display.homeReadyAt);
      expect(timings.firstHomeCompletePaint).toBe(Math.round(display.paintedAt * 1000) / 1000);
      // 실제 서버가 2초보다 느릴 수 있으므로 빠른 경로는 가짜 타이머 unit에서 별도 검증합니다.
      // 여기서는 실서버 준비 시점과 실제 화면 전환·접속 계측을 함께 남깁니다.
      for (const source of ['ledger', 'categories', 'currencyPreferences', 'currencyBalances']) {
        expect(timings).toHaveProperty(source + 'InitialReadReceived');
        expect(timings).toHaveProperty(source + 'InitialReadCompleted');
        expect(timings[source + 'InitialReadCompleted']).toBeLessThanOrEqual(timings[source + 'InitialReadReceived']);
        expect(timings).not.toHaveProperty(source + 'InitialReadFallback');
        expect(timings).not.toHaveProperty(source + 'ServerSnapshotReceived');
      }
      expect(heldRequests).toBeGreaterThan(0);
      expect(restResponses.filter(kind => kind === 'runQuery').length).toBeGreaterThanOrEqual(2);
      expect(restResponses.filter(kind => kind === 'batchGet').length).toBeGreaterThanOrEqual(2);
      release();
      // Real server writes, followed by actual SDK subscription delivery.
      const transactionPath = `households/${householdId}/ledgerTransactions/${transaction.name.split('/').at(-1)}`;
      await writeFirestoreFixture(request, transactionPath, { ...transaction.fields,
        amountInWon: { integerValue: '15400' }, aggregateVersion: { integerValue: '2' }, memo: { stringValue: '구독 전환 후' },
      });
      await expect(expense).toContainText('15,400원');
      await expect(expense).toContainText('구독 전환 후');
      await expect(monthly).toContainText('15,400');
      await writeFirestoreFixture(request, transactionPath, { ...transaction.fields,
        lifecycleState: { stringValue: 'deleted' }, aggregateVersion: { integerValue: '3' },
      });
      await expect(expense).toHaveCount(0);
      await testInfo.attach('initial-read-live-handoff', { contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ timings, heldRequests, restResponses, display }, null, 2)) });
    } finally {
      release();
      await restarted.unrouteAll({ behavior: 'wait' });
    }
  });
});

test('[T-SYS-008][T-ADM-005][ADM-006][AND-012][SYS-008] iPhone WebKit 재실행은 로그인 유지와 Firestore IndexedDB 대기 없이 최신 홈을 표시한다', async ({ page: initialPage, context, request }, testInfo) => {
  let page = initialPage;
  // WebKit의 standalone 감지만 설정합니다. Auth/Firestore SDK와 서버 응답은 실제입니다.
  await observeIndexedDbOpens(page, true);
  const errors: string[] = [];
  const initialVisits = observeAppVisits(page);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '테스트 계정으로 로그인' }).click();
  await page.getByRole('button', { name: '새 가계부 만들기' }).click();
  await page.getByLabel('가계부 이름').fill('iOS 시작 테스트');
  await page.getByPlaceholder('내 이름').fill('아이폰 사용자');
  await page.getByRole('button', { name: '가계부 만들기' }).click();
  let calendar = page.locator('.calendar-glass');
  await expect(calendar).toHaveAttribute('aria-busy', 'false');
  const households = await readFirestoreCollection(request, 'households');
  expect(households).toHaveLength(1);
  const householdId = households[0].name.split('/').at(-1)!;
  expect(await readFirestoreCollection(request, `households/${householdId}/localCurrencyBalances`)).toHaveLength(0);
  // 잔액 문서가 없는 실제 서버 snapshot도 수신·준비 단계로 관측되어야 합니다.
  // fixture를 쓰기 전에 첫 접속 기록을 받아 이후 snapshot으로 가려지지 않게 합니다.
  const initialVisit = await acceptedAppVisit(initialVisits);
  const initialDiagnostics = initialVisit.clientStartupDiagnostics;
  expect(initialDiagnostics, '빈 잔액으로 완료된 첫 홈에도 실제 시작 진단이 있어야 합니다.').toBeDefined();
  if (!initialDiagnostics) throw new Error('IOS_INITIAL_STARTUP_DIAGNOSTICS_MISSING');
  expectServerReadinessOrder(initialDiagnostics.timingsMs);
  for (const [key, value] of Object.entries(initialDiagnostics.timingsMs)) {
    expect(Number.isFinite(value), `첫 홈의 ${key}는 유한한 navigation offset이어야 합니다.`).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(initialVisit.clientStartupDurationMs);
  }
  await writeFirestoreFixture(request, `households/${householdId}/homePreferences/home`, {
    left: { stringValue: 'MONTHLY_EXPENSE' }, right: { stringValue: 'LOCAL_CURRENCY_BALANCE' },
    aggregateVersion: { integerValue: '1' }, selectedLocalCurrencyType: { stringValue: 'gyeonggi' },
  });
  await writeFirestoreFixture(request, `households/${householdId}/localCurrencyBalances/gyeonggi`, {
    localCurrencyType: { stringValue: 'gyeonggi' }, balanceInWon: { integerValue: '25789' },
  });
  let firstDay = page.getByTestId(/^calendar-day-/).first();
  await expect(firstDay).toHaveAttribute('data-testid', /^calendar-day-\d{4}-\d{2}-01$/);
  await firstDay.click();
  await page.getByRole('button', { name: '지출 추가' }).click();
  const dialog = page.getByRole('dialog', { name: '지출 추가' });
  await dialog.getByPlaceholder('가맹점명을 입력하세요').fill('iOS 시작 카페');
  await dialog.locator('input[type="number"]').fill('12300');
  await dialog.getByRole('button', { name: '기타', exact: true }).click();
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  let monthlyCard = page.locator('.balance-card-glass').filter({ hasText: /월 지출/ });
  let currencyCard = page.locator('.balance-card-glass').filter({ hasText: '지역화폐 잔액' });
  await expect(monthlyCard).toContainText('12,300');
  await expect(currencyCard).toContainText('25,789');

  // 열린 stream을 가로채지 않고 실제 재실행을 검사합니다. 앱이 닫힌 동안
  // 서버 잔액을 바꿔 이전 화면의 값이 아니라 최신 결과를 읽는지 확인합니다.
  await page.close();
  await writeFirestoreFixture(request, `households/${householdId}/localCurrencyBalances/gyeonggi`, {
    localCurrencyType: { stringValue: 'gyeonggi' }, balanceInWon: { integerValue: '36890' },
  });
  page = await context.newPage();
  await observeIndexedDbOpens(page, true);
  const restartedVisits = observeAppVisits(page);
  page.on('pageerror', (error) => errors.push(error.message));
  calendar = page.locator('.calendar-glass');
  firstDay = page.getByTestId(/^calendar-day-/).first();
  monthlyCard = page.locator('.balance-card-glass').filter({ hasText: /월 지출/ });
  currencyCard = page.locator('.balance-card-glass').filter({ hasText: '지역화폐 잔액' });

  await page.goto('/');
  await expect(calendar).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: '테스트 계정으로 로그인' })).toHaveCount(0);
  await expect(monthlyCard).toContainText('12,300');
  await expect(currencyCard).toContainText('36,890');
  await firstDay.click();
  const expenseItem = page.getByTestId('expense-item').filter({ hasText: 'iOS 시작 카페' });
  await expect(expenseItem).toContainText('12,300원');
  await expect(expenseItem.getByText('기타', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate((name) => performance.getEntriesByName(name).length, COMPLETE_PAINT)).toBe(1);
  const databaseNames = await readIndexedDbOpens(page);
  expect(databaseNames.some((name) => name === 'firebaseLocalStorageDb')).toBe(true);
  expect(databaseNames.some((name) => name.startsWith('firestore/'))).toBe(false);

  const restartedVisit = await acceptedAppVisit(restartedVisits);
  expect(restartedVisit.visitId).not.toBe(initialVisit.visitId);
  const diagnostics = restartedVisit.clientStartupDiagnostics;
  expect(diagnostics, '재실행의 실제 접속 요청에 상세 시작 진단을 포함해야 합니다.').toBeDefined();
  if (!diagnostics) throw new Error('IOS_STARTUP_DIAGNOSTICS_MISSING');
  expect(diagnostics.version).toBe(1);
  expect(diagnostics.webBuild).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
  expect(diagnostics.webBuild).toBe(initialVisit.clientStartupDiagnostics?.webBuild);
  expect((await request.get(`/_next/static/${diagnostics.webBuild}/_buildManifest.js`)).ok()).toBe(true);
  expect(diagnostics.initialVisibility).toBe('visible');
  expect(diagnostics.hiddenMs).toBe(0);
  expect(diagnostics.hiddenCount).toBe(0);
  expect(typeof diagnostics.serviceWorkerControlled).toBe('boolean');
  expect(diagnostics.yearSummaryRequired).toBe(false);

  const browserTiming = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return {
      now: performance.now(),
      navigation: {
        type: navigation.type,
        responseStart: navigation.responseStart,
        responseEnd: navigation.responseEnd,
        domInteractive: navigation.domInteractive,
      },
      marks: Object.fromEntries(performance.getEntriesByType('mark')
        .map((entry) => [entry.name, entry.startTime])),
      // endpoint 일치 여부만 검사하고 URL·query·토큰 원문은 반환하거나 첨부하지 않습니다.
      tokenRequests: (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
        .filter((entry) => {
          const url = new URL(entry.name);
          return url.origin === 'https://securetoken.googleapis.com' && url.pathname === '/v1/token';
        })
        .map((entry) => ({ startTime: entry.startTime, responseEnd: entry.responseEnd })),
    };
  });
  await testInfo.attach('ios-startup-read-phases', {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({
      initial: { durationMs: initialVisit.clientStartupDurationMs, timingsMs: initialDiagnostics.timingsMs },
      restarted: { durationMs: restartedVisit.clientStartupDurationMs, timingsMs: diagnostics.timingsMs },
      tokenRequests: browserTiming.tokenRequests,
    }, null, 2)),
  });
  expect(diagnostics.navigationType).toBe(browserTiming.navigation.type);
  expect(Number.isFinite(restartedVisit.clientStartupDurationMs)).toBe(true);
  expect(restartedVisit.clientStartupDurationMs).toBeGreaterThan(0);
  expect(restartedVisit.clientStartupDurationMs).toBeLessThanOrEqual(browserTiming.now);
  expect(diagnostics.visibilityTrackingStartedAtMs).toBeGreaterThanOrEqual(0);
  expect(diagnostics.visibilityTrackingStartedAtMs).toBeLessThanOrEqual(restartedVisit.clientStartupDurationMs);

  const timings = diagnostics.timingsMs;
  for (const [key, browserValue] of Object.entries({
    navigationResponseStart: browserTiming.navigation.responseStart,
    navigationResponseEnd: browserTiming.navigation.responseEnd,
    domInteractive: browserTiming.navigation.domInteractive,
  })) {
    expect(timings[key], `${key}는 Navigation Timing의 offset이어야 합니다.`).toBeCloseTo(browserValue, 2);
  }
  const phaseMarks = {
    bootstrapStarted: 'bootstrap:started', authStarted: 'auth:started', authReady: 'auth:ready',
    membershipStarted: 'membership:started', membershipReady: 'membership:ready',
    householdStarted: 'household:started', householdReady: 'household:ready',
    ledgerReady: 'ledger:ready', categoriesReady: 'categories:ready',
    localCurrencyReady: 'local-currency:ready', yearSummaryReady: 'year-summary:ready',
    homeReady: 'home:ready', firstLedgerPaint: 'ledger:first-paint',
    firstHomeCompletePaint: 'home:first-complete-paint',
  };
  for (const key of ['bootstrapStarted', 'authStarted', 'authTokenObserved', 'authReady', 'ledgerReady',
    'categoriesReady', 'localCurrencyReady', 'homeReady', 'firstLedgerPaint', 'firstHomeCompletePaint']) {
    expect(timings, `${key}의 최초 실제 준비 시각을 기록해야 합니다.`).toHaveProperty(key);
  }
  for (const key of ['yearSummaryListenStarted', 'yearSummaryFirstSnapshotReceived',
    'yearSummaryServerSnapshotReceived', 'yearSummaryReady']) {
    expect(timings[key], '필요하지 않은 연간 합계의 읽기·snapshot·준비 시각을 만들어서는 안 됩니다.').toBeUndefined();
  }
  expect(timings.authTokenObserved).toBeGreaterThanOrEqual(timings.authStarted);
  expect(timings.authReady).toBeGreaterThanOrEqual(timings.authTokenObserved);
  expectServerReadinessOrder(timings);
  // 가구 metadata는 복원한 scope의 홈 읽기와 병렬이므로 homeReady의 선행조건으로 삼지 않습니다.
  if (timings.householdReadStarted !== undefined) {
    expect(timings.householdReadStarted).toBeGreaterThanOrEqual(timings.householdStarted);
  }
  if (timings.householdSnapshotReceived !== undefined) {
    expect(timings).toHaveProperty('householdReadStarted');
    expect(timings.householdSnapshotReceived).toBeGreaterThanOrEqual(timings.householdReadStarted);
  }
  if (timings.householdReady !== undefined) {
    expect(timings).toHaveProperty('householdSnapshotReceived');
    expect(timings.householdReady).toBeGreaterThanOrEqual(timings.householdSnapshotReceived);
  }
  const completedTokenRequests = browserTiming.tokenRequests.filter((entry) =>
    entry.startTime >= 0 && entry.responseEnd > 0 && entry.responseEnd >= entry.startTime
      && entry.responseEnd <= restartedVisit.clientStartupDurationMs
  ).sort((left, right) => left.startTime - right.startTime);
  if (timings.authTokenRequestStarted !== undefined || timings.authTokenResponseEnd !== undefined) {
    expect(timings).toHaveProperty('authTokenRequestStarted');
    expect(timings).toHaveProperty('authTokenResponseEnd');
    expect(timings.authTokenResponseEnd).toBeGreaterThanOrEqual(timings.authTokenRequestStarted);
    expect(completedTokenRequests.length, '토큰 단계는 paint 전에 완료된 실제 Resource Timing이 있어야 합니다.').toBeGreaterThan(0);
    // startTime은 연결 준비 등을 포함한 리소스 시작이며 HTTP 전송 시작(requestStart)은 아닙니다.
    expect(timings.authTokenRequestStarted).toBeCloseTo(completedTokenRequests[0].startTime, 2);
    expect(timings.authTokenResponseEnd).toBeCloseTo(completedTokenRequests[0].responseEnd, 2);
  }
  if (completedTokenRequests.length === 0) {
    expect(timings.authTokenRequestStarted, '완료된 요청 관측이 없으면 토큰 시작 시각을 추정하지 않습니다.').toBeUndefined();
    expect(timings.authTokenResponseEnd, '완료된 요청 관측이 없으면 토큰 응답 시각을 추정하지 않습니다.').toBeUndefined();
  }
  for (const [key, value] of Object.entries(timings)) {
    expect(Number.isFinite(value), `${key}는 유한한 navigation offset이어야 합니다.`).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(restartedVisit.clientStartupDurationMs);
    if (key in phaseMarks) {
      const mark = browserTiming.marks[`household-account:startup:${phaseMarks[key as keyof typeof phaseMarks]}`];
      expect(mark, `${key}와 대응하는 실제 Performance mark가 있어야 합니다.`).toBeDefined();
      // 동일 callback의 mark와 진단 관측 사이의 미세한 실행 시간만 허용합니다.
      expect(Math.abs(value - mark), `${key}를 구간 duration 또는 epoch로 기록하면 안 됩니다.`).toBeLessThan(25);
    }
  }
  expect(timings.homeReady).toBeGreaterThanOrEqual(Math.max(
    timings.ledgerReady, timings.categoriesReady, timings.localCurrencyReady
  ));
  expect(timings.firstHomeCompletePaint).toBeGreaterThanOrEqual(timings.homeReady);
  expect(diagnostics.cache?.membership).toBe('hit');
  for (const cache of ['bootstrap', 'household'] as const) {
    const markPrefix = `household-account:startup:${cache}-cache:`;
    const observedCache = browserTiming.marks[`${markPrefix}hit`] !== undefined ? 'hit'
      : browserTiming.marks[`${markPrefix}miss`] !== undefined ? 'miss' : undefined;
    expect(diagnostics.cache?.[cache], '실제로 관측하지 않은 cache 결과를 추정하지 않습니다.').toBe(observedCache);
  }
  expect(restartedVisits.requests, '홈 표시와 날짜 선택은 같은 문서의 접속 진단을 다시 보내면 안 됩니다.').toHaveLength(1);
  expect(initialVisits.requests).toHaveLength(1);
  expect(errors).toEqual([]);
});
